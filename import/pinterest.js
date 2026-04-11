#!/usr/bin/env node
'use strict';

const fs         = require('fs');
const path       = require('path');
const puppeteer  = require('puppeteer');
const { SingleBar, Presets } = require('cli-progress');
const { v4: uuidv4 } = require('uuid');

const { db }         = require('../server/db');
const { parseExport }  = require('./lib/parseExport');
const { buildQueue }   = require('./lib/queueBuilder');
const { resolvePin }   = require('./lib/resolver');
const { downloadPin }  = require('./lib/downloader');
const { logFailed, LOG_PATH } = require('./lib/logger');

// ── Arg parsing ────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    file: null,
    concurrency: 3,
    delay: 1000,
    dryRun: false,
    resume: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if      (a === '--file'        && argv[i+1]) { args.file        = argv[++i]; continue; }
    else if (a.startsWith('--file='))            { args.file        = a.slice(7); continue; }
    if      (a === '--concurrency' && argv[i+1]) { args.concurrency = parseInt(argv[++i], 10); continue; }
    else if (a.startsWith('--concurrency='))     { args.concurrency = parseInt(a.slice(14), 10); continue; }
    if      (a === '--delay'       && argv[i+1]) { args.delay       = parseInt(argv[++i], 10); continue; }
    else if (a.startsWith('--delay='))           { args.delay       = parseInt(a.slice(8), 10); continue; }
    if      (a === '--dry-run')  { args.dryRun  = true; continue; }
    if      (a === '--resume')   { args.resume  = true; continue; }
  }
  return args;
}

function expandPath(p) {
  if (!p) return p;
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME || process.env.USERPROFILE || '', p.slice(1));
  }
  return path.resolve(p);
}

// ── Error classification ───────────────────────────────────────────
function classifyError(err) {
  // Puppeteer TimeoutError
  if (err.name === 'TimeoutError' || (err.constructor && err.constructor.name === 'TimeoutError')) {
    return 'timeout';
  }
  const msg = err.message || '';
  if (/timeout/i.test(msg))              return 'timeout';
  if (msg === '404')                     return '404';
  if (/page not found|404/i.test(msg))   return '404';
  if (msg.startsWith('HTTP '))           return msg;
  if (msg === 'no image found')          return 'no image found';
  if (msg === 'no pin URL')              return 'no pin URL in export';
  if (/download/i.test(msg))             return `download failed: ${msg}`;
  return msg || 'unknown error';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Per-pin processing ─────────────────────────────────────────────
async function processPin(page, pin, args, stats, bar) {
  try {
    // Duplicate check against existing images (by source_url from CSV)
    if (pin.source_url) {
      const dup = db.prepare('SELECT 1 FROM images WHERE source_url = ? LIMIT 1').get(pin.source_url);
      if (dup) {
        db.prepare("UPDATE import_queue SET status = 'skipped' WHERE id = ?").run(pin.id);
        stats.skipped++;
        bar.increment({ failed: stats.failed });
        return;
      }
    }

    // Also skip if no pin URL (can't resolve without it)
    if (!pin.pin_url) {
      throw new Error('no pin URL');
    }

    // Resolve image URL via Puppeteer
    const imageUrl = await resolvePin(page, pin);

    // Record the resolved URL
    db.prepare("UPDATE import_queue SET resolved_image_url = ? WHERE id = ?").run(imageUrl, pin.id);

    // Download image + generate thumbnail
    const { filename, thumbnail } = await downloadPin(imageUrl);

    // Save to images table, wire up tag, mark done — in a transaction
    const savePin = db.transaction(() => {
      const imageId = uuidv4();
      db.prepare(`
        INSERT INTO images (id, filename, thumbnail, source_url, page_title, page_url)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        imageId,
        filename,
        thumbnail,
        imageUrl,        // source_url = the actual image URL
        pin.title || null,
        pin.pin_url      // page_url = the Pinterest pin page
      );
      if (pin.tag_id) {
        db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)')
          .run(imageId, pin.tag_id);
      }
      db.prepare("UPDATE import_queue SET status = 'done', imported_at = ? WHERE id = ?")
        .run(new Date().toISOString(), pin.id);
    });
    savePin();

    stats.done++;
    bar.increment({ failed: stats.failed });

  } catch (err) {
    const reason = classifyError(err);
    db.prepare("UPDATE import_queue SET status = 'failed', failure_reason = ? WHERE id = ?")
      .run(reason, pin.id);
    stats.failed++;
    logFailed({ pin_url: pin.pin_url || '(none)', board_name: pin.board_name, title: pin.title, failure_reason: reason });
    bar.increment({ failed: stats.failed });
  }

  // Always clear page state after each pin
  try { await page.goto('about:blank', { timeout: 5000 }); } catch (_) {}

  // Delay between requests (per page, not global)
  if (args.delay > 0) await sleep(args.delay);
}

// ── Concurrency pool ───────────────────────────────────────────────
async function runPool(pendingPins, browser, args, stats, bar) {
  const queue = [...pendingPins];

  // Create N pages (browser tabs) upfront
  const pages = await Promise.all(
    Array.from({ length: args.concurrency }, () => browser.newPage())
  );

  // Block unnecessary resource types to speed up Pinterest navigation
  for (const page of pages) {
    await page.setRequestInterception(true);
    page.on('request', req => {
      const type = req.resourceType();
      if (['font', 'media', 'stylesheet'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  async function worker(page) {
    while (queue.length > 0) {
      const pin = queue.shift();
      if (!pin) break;
      await processPin(page, pin, args, stats, bar);
    }
  }

  // Run all workers in parallel; each drains from the shared queue
  await Promise.all(pages.map(page => worker(page)));

  // Clean up pages
  for (const page of pages) {
    try { await page.close(); } catch (_) {}
  }
}

// ── Main ───────────────────────────────────────────────────────────
let browser = null;

// Graceful shutdown on Ctrl+C
process.on('SIGINT', async () => {
  process.stderr.write('\n\n[gotcha-import] Interrupted. Closing browser...\n');
  if (browser) {
    try { await browser.close(); } catch (_) {}
  }
  process.exit(130); // 130 = killed by SIGINT convention
});

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Validate required args
  if (!args.file) {
    console.error('Usage: node import/pinterest.js --file <path.zip|path.csv> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --file <path>         Pinterest export ZIP or CSV (required)');
    console.error('  --concurrency <n>     Parallel browser pages (default: 3)');
    console.error('  --delay <ms>          Delay between requests per page (default: 1000)');
    console.error('  --dry-run             Parse and queue only, skip downloads');
    console.error('  --resume              Skip pins already marked done');
    process.exit(1);
  }

  args.file = expandPath(args.file);

  if (!fs.existsSync(args.file)) {
    console.error(`[gotcha-import] File not found: ${args.file}`);
    process.exit(1);
  }

  if (isNaN(args.concurrency) || args.concurrency < 1 || args.concurrency > 10) {
    console.error('[gotcha-import] --concurrency must be between 1 and 10');
    process.exit(1);
  }

  console.log('\n[gotcha-import] Pinterest Import Tool');
  console.log('=====================================');

  // ── Phase 1: Parse export ──
  console.log(`\nParsing export: ${args.file}`);
  let pins;
  try {
    pins = parseExport(args.file);
  } catch (err) {
    console.error(`[gotcha-import] Failed to parse export: ${err.message}`);
    process.exit(1);
  }

  const boardCount = new Set(pins.map(p => p.board_name)).size;
  console.log(`Found ${pins.length.toLocaleString()} pins across ${boardCount} tags`);

  // ── Phase 1b: Build queue ──
  console.log('Creating tags and building queue...');
  let queueResult;
  try {
    queueResult = buildQueue(pins, { resume: args.resume });
  } catch (err) {
    console.error(`[gotcha-import] Failed to build queue: ${err.message}`);
    process.exit(1);
  }

  console.log(
    `Tags created: ${queueResult.tagsCreated} | ` +
    `Pins queued: ${queueResult.pinsInserted} | ` +
    `Already done: ${queueResult.pinsAlreadyDone}`
  );

  if (args.dryRun) {
    console.log('\n[dry-run] Exiting without downloading images.');
    process.exit(0);
  }

  // ── Phase 2: Resolve + download ──
  const pendingPins = db.prepare(
    "SELECT * FROM import_queue WHERE status IN ('pending', 'failed')"
  ).all();

  if (pendingPins.length === 0) {
    console.log('\nNothing to process — all pins already done.');
    if (!args.resume) {
      console.log('Tip: use --resume to retry failed pins.');
    }
    process.exit(0);
  }

  console.log(`\nProcessing ${pendingPins.length.toLocaleString()} pins`);
  console.log(`  Concurrency : ${args.concurrency} parallel pages`);
  console.log(`  Delay       : ${args.delay}ms between requests`);
  console.log('');

  // Pinterest blocks headless Chrome — must run with a visible browser
  console.log('  Note        : Chrome will open briefly — Pinterest blocks headless browsers');
  console.log('');
  browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=900,700',
    ],
  });

  const stats = { done: 0, failed: 0, skipped: 0 };

  const bar = new SingleBar({
    format: '[gotcha-import] [{bar}] {value}/{total} | Failed: {failed}',
    hideCursor: true,
    clearOnComplete: false,
  }, Presets.shades_classic);

  bar.start(pendingPins.length, 0, { failed: 0 });

  try {
    await runPool(pendingPins, browser, args, stats, bar);
  } finally {
    bar.stop();
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
  }

  // ── Summary ──
  console.log('\n[gotcha-import] Done');
  console.log('─────────────────────');
  console.log(`  Imported : ${stats.done.toLocaleString()}`);
  console.log(`  Skipped  : ${stats.skipped.toLocaleString()} (duplicates)`);
  console.log(`  Failed   : ${stats.failed.toLocaleString()}`);

  if (stats.failed > 0) {
    console.log(`\nFailed pins logged to: ${LOG_PATH}`);
    console.log('Re-run with --resume to retry failed pins.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('\n[gotcha-import] Fatal error:', err.message);
  if (browser) browser.close().catch(() => {});
  process.exit(1);
});
