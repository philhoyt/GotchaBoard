'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');
const { db } = require('../db');

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.svg']);
const MIN_DIMENSION = 200; // ignore tiny images (icons, spacers)

// ── fetchText ──────────────────────────────────────────────────────
function fetchText(rawUrl, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(rawUrl); } catch (e) { return reject(e); }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(rawUrl, {
      headers: { 'User-Agent': 'GotchaBoard/1.0 (+https://github.com/gotchaboard)' },
      timeout,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── extractOgImage ────────────────────────────────────────────────
// Extracts og:image from a <meta> tag regardless of attribute order.
function extractOgImage(html, baseUrl) {
  const base = new URL(baseUrl);
  // Match <meta> tags that have both property="og:image" and content="..."
  // in either order, with any other attributes in between.
  const metaRe = /<meta\s[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    if (!/property=["']og:image["']/i.test(tag)) continue;
    const contentMatch = tag.match(/content=["']([^"']+)["']/i);
    if (contentMatch) {
      try { return new URL(contentMatch[1], base).href; } catch (_) {}
    }
  }
  return null;
}

// ── extractImages ─────────────────────────────────────────────────
// Extracts image src URLs from raw HTML, resolved against baseUrl.
// If ogOnly is true, returns only the og:image (best for article pages).
function extractImages(html, baseUrl, { ogOnly = false } = {}) {
  const base = new URL(baseUrl);

  const ogImage = extractOgImage(html, baseUrl);

  if (ogOnly) {
    return ogImage ? [ogImage] : [];
  }

  const urls = new Set();
  if (ogImage) urls.add(ogImage);

  // <img src="..."> and <img data-src="...">
  const imgRe = /<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base);
      const ext = u.pathname.split('.').pop()?.toLowerCase();
      if (IMAGE_EXTS.has('.' + ext)) urls.add(u.href);
    } catch (_) {}
  }

  return [...urls];
}

// ── extractLinks ──────────────────────────────────────────────────
// Extracts <a href> links from HTML, resolved against baseUrl.
function extractLinks(html, baseUrl) {
  const urls = new Set();
  const base = new URL(baseUrl);
  const re = /<a[^>]+href=["']([^"'#?][^"']*?)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        urls.add(u.href);
      }
    } catch (_) {}
  }
  return [...urls];
}

// ── isAlreadyKnown ────────────────────────────────────────────────
function isAlreadyKnown(imageUrl) {
  const inLibrary   = db.prepare('SELECT id FROM images WHERE source_url = ? LIMIT 1').get(imageUrl);
  const inCandidates = db.prepare(
    "SELECT id FROM discover_candidates WHERE image_url = ? AND status != 'dismissed' LIMIT 1"
  ).get(imageUrl);
  return !!(inLibrary || inCandidates);
}

// ── queueCandidate ────────────────────────────────────────────────
function queueCandidate({ image_url, page_url, page_title, source_type, source_id = null, source_query = null }) {
  // Upgrade http → https for consistency
  if (image_url.startsWith('http://')) {
    image_url = 'https://' + image_url.slice(7);
  }
  if (isAlreadyKnown(image_url)) return false;
  try {
    db.prepare(`
      INSERT OR IGNORE INTO discover_candidates
        (image_url, page_url, page_title, source_type, source_id, source_query)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(image_url, page_url || null, page_title || null, source_type, source_id, source_query);
    return true;
  } catch (_) {
    return false;
  }
}

// ── crawlPage ─────────────────────────────────────────────────────
// Fetches a page, queues images as candidates, returns discovered links.
// ogOnly: when true, only extracts the og:image (best for article pages from RSS).
async function crawlPage(pageUrl, sourceType, sourceId = null, { ogOnly = false } = {}) {
  let html;
  try { html = await fetchText(pageUrl); } catch (_) { return []; }

  const images = extractImages(html, pageUrl, { ogOnly });
  let queued = 0;
  for (const img of images) {
    if (queueCandidate({ image_url: img, page_url: pageUrl, source_type: sourceType, source_id: sourceId })) {
      queued++;
    }
  }

  console.log(`[crawler] ${pageUrl} → ${images.length} images, ${queued} queued`);
  return extractLinks(html, pageUrl);
}

// ── runSourceCrawler ──────────────────────────────────────────────
// Re-crawls pages where saved images came from.
// Skips known JS-rendered hosts that never yield images.
const SKIP_HOSTS = new Set(['www.pinterest.com', 'pinterest.com', 'www.reddit.com', 'reddit.com', 'www.facebook.com', 'facebook.com']);

async function runSourceCrawler() {
  const hopDepth    = parseInt(process.env.LINK_HOP_DEPTH || '1');
  const followExternal = (process.env.LINK_HOP_EXTERNAL || 'true') === 'true';

  // Unique source pages from saved images (skip local uploads and known dead hosts)
  const sourcePages = db.prepare(`
    SELECT DISTINCT page_url FROM images
    WHERE page_url IS NOT NULL
      AND page_url NOT LIKE 'local://%'
    LIMIT 100
  `).all()
    .map(r => r.page_url)
    .filter(url => {
      try { return !SKIP_HOSTS.has(new URL(url).hostname); } catch (_) { return false; }
    });

  for (const pageUrl of sourcePages) {
    const links = await crawlPage(pageUrl, 'crawl');

    if (hopDepth >= 1) {
      let base;
      try { base = new URL(pageUrl); } catch (_) { continue; }

      for (const link of links.slice(0, 30)) {
        // Skip already-hopped pages
        const already = db.prepare('SELECT id FROM discover_link_hops WHERE url = ? LIMIT 1').get(link);
        if (already) continue;

        let linkBase;
        try { linkBase = new URL(link); } catch (_) { continue; }

        const isInternal = linkBase.hostname === base.hostname;
        if (!isInternal && !followExternal) continue;

        const before = db.prepare("SELECT COUNT(*) as n FROM discover_candidates WHERE status = 'pending'").get().n;
        await crawlPage(link, 'link_hop');
        const after = db.prepare("SELECT COUNT(*) as n FROM discover_candidates WHERE status = 'pending'").get().n;

        db.prepare(`
          INSERT OR REPLACE INTO discover_link_hops (url, found_from_url, candidates_queued)
          VALUES (?, ?, ?)
        `).run(link, pageUrl, after - before);
      }
    }
  }
}

// ── runRssScraper ─────────────────────────────────────────────────
// Fetches each user-defined RSS/scrape source.
async function runRssScraper() {
  const now = new Date().toISOString();
  const sources = db.prepare(`
    SELECT * FROM discover_sources
    WHERE last_fetched_at IS NULL
       OR datetime(last_fetched_at, '+' || fetch_interval_hours || ' hours') < datetime('now')
  `).all();

  for (const source of sources) {
    try {
      if (source.type === 'rss') {
        await crawlRssFeed(source);
      } else {
        await crawlPage(source.url, 'rss', source.id);
      }
      db.prepare('UPDATE discover_sources SET last_fetched_at = ? WHERE id = ?').run(now, source.id);
    } catch (err) {
      console.error(`[crawler] source ${source.id} failed:`, err.message);
    }
  }
}

// ── crawlRssFeed ──────────────────────────────────────────────────
async function crawlRssFeed(source) {
  let xml;
  try { xml = await fetchText(source.url); } catch (_) { return; }

  // Extract item links from RSS/Atom
  const linkRe = /<link>([^<]+)<\/link>|<link[^>]+href=["']([^"']+)["']/g;
  const encRe  = /<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']+["']/gi;
  const mediaRe = /<media:content[^>]+url=["']([^"']+)["']/gi;

  const itemLinks = [];
  let m;
  while ((m = linkRe.exec(xml)) !== null) {
    const url = (m[1] || m[2] || '').trim();
    if (url.startsWith('http')) itemLinks.push(url);
  }

  // Direct image enclosures and media:content tags
  while ((m = encRe.exec(xml)) !== null) {
    queueCandidate({ image_url: m[1], page_url: source.url, source_type: 'rss', source_id: source.id });
  }
  while ((m = mediaRe.exec(xml)) !== null) {
    queueCandidate({ image_url: m[1], page_url: source.url, source_type: 'rss', source_id: source.id });
  }

  // Images embedded in <description> or <content:encoded> HTML (e.g. Core77)
  const descRe    = /<(?:description|content:encoded)>([\s\S]*?)<\/(?:description|content:encoded)>/gi;
  const embImgRe  = /src=["']([^"']+\.(?:jpg|jpeg|png|webp|gif|avif))["']/gi;
  while ((m = descRe.exec(xml)) !== null) {
    const decoded = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    let img;
    while ((img = embImgRe.exec(decoded)) !== null) {
      if (img[1].startsWith('http')) {
        queueCandidate({ image_url: img[1], page_url: source.url, source_type: 'rss', source_id: source.id });
      }
    }
    embImgRe.lastIndex = 0; // reset for next description block
  }

  // Crawl item pages — og:image only to get the full-size hero photo
  for (const link of itemLinks.slice(0, 20)) {
    await crawlPage(link, 'rss', source.id, { ogOnly: true });
  }
}

// ── runDiscoverCycle ──────────────────────────────────────────────
// Runs all available sources. Called manually or by cron job.
async function runDiscoverCycle() {
  console.log('[discover] Starting discovery cycle...');

  try {
    await runSourceCrawler();
    console.log('[discover] Source crawler done.');
  } catch (err) {
    console.error('[discover] Source crawler error:', err.message);
  }

  try {
    await runRssScraper();
    console.log('[discover] RSS scraper done.');
  } catch (err) {
    console.error('[discover] RSS scraper error:', err.message);
  }

  console.log('[discover] Cycle complete.');
}

module.exports = { runDiscoverCycle, runSourceCrawler, runRssScraper, crawlPage, queueCandidate };
