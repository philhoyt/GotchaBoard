'use strict';

const cron = require('node-cron');
const { db } = require('../db');
const { runDiscoverCycle, runSourceCrawler, runRssScraper } = require('../lib/crawler');

// ── Auto-promote ───────────────────────────────────────────────────
// No scoring gate — all pending candidates go straight to shown.
function promoteAllPending() {
  const result = db.prepare(
    "UPDATE discover_candidates SET status = 'shown' WHERE status = 'pending'"
  ).run();
  if (result.changes > 0) {
    console.log(`[discover] Promoted ${result.changes} pending candidates to shown`);
  }
}

// ── Job runner wrapper ─────────────────────────────────────────────
function safe(name, fn) {
  return async () => {
    console.log(`[jobs] Starting: ${name}`);
    try {
      await fn();
      console.log(`[jobs] Finished: ${name}`);
    } catch (err) {
      console.error(`[jobs] Error in ${name}:`, err.message);
    }
  };
}

// ── Schedule definitions ───────────────────────────────────────────
function startJobs() {
  // Source URL crawler + link hops — daily at 2am
  cron.schedule('0 2 * * *', safe('source-crawler', runSourceCrawler));

  // RSS / scrape fetcher — daily at 3am
  cron.schedule('0 3 * * *', safe('rss-scraper', runRssScraper));

  // Promote any pending candidates every 15 minutes
  cron.schedule('*/15 * * * *', safe('promote-pending', promoteAllPending));

  console.log('[jobs] Discover jobs scheduled');
}

module.exports = { startJobs, promoteAllPending };
