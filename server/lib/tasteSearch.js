'use strict';

const https = require('https');
const { db } = require('../db');
const { queueCandidate } = require('./crawler');

// ── JSON fetch helper ──────────────────────────────────────────────
function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Unsplash search ────────────────────────────────────────────────
async function searchUnsplash(query, perPage = 20) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY not set');

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const data = await fetchJSON(url, {
    'Authorization': `Client-ID ${key}`,
    'Accept-Version': 'v1',
  });

  return (data.results || []).map(photo => ({
    image_url: photo.urls?.regular || photo.urls?.full,
    page_url:  photo.links?.html,
    page_title: photo.description || photo.alt_description || null,
  })).filter(r => r.image_url);
}

// ── runTasteSearch ─────────────────────────────────────────────────
// Pulls unrun queries from discover_search_queries, searches Unsplash,
// queues candidates. If no queries exist, does nothing (profile/refresh
// populates the query table when a taste profile is generated).
async function runTasteSearch() {
  if (!process.env.UNSPLASH_ACCESS_KEY) {
    console.log('[taste-search] Skipping — UNSPLASH_ACCESS_KEY not set');
    return;
  }

  const queriesPerCycle  = parseInt(process.env.TASTE_SEARCH_QUERIES_PER_CYCLE  || '10');
  const resultsPerQuery  = parseInt(process.env.TASTE_SEARCH_RESULTS_PER_QUERY  || '20');

  // Pick queries that haven't been run yet, then fall back to least-recently-run
  const pending = db.prepare(`
    SELECT * FROM discover_search_queries
    WHERE run_at IS NULL
    ORDER BY id ASC
    LIMIT ?
  `).all(queriesPerCycle);

  const toRun = pending.length > 0
    ? pending
    : db.prepare(`
        SELECT * FROM discover_search_queries
        ORDER BY run_at ASC
        LIMIT ?
      `).all(queriesPerCycle);

  if (toRun.length === 0) {
    console.log('[taste-search] No queries available — generate a taste profile first');
    return;
  }

  console.log(`[taste-search] Running ${toRun.length} queries against Unsplash`);

  for (const q of toRun) {
    try {
      const results = await searchUnsplash(q.query_text, resultsPerQuery);
      let queued = 0;

      for (const r of results) {
        if (queueCandidate({
          image_url:   r.image_url,
          page_url:    r.page_url,
          page_title:  r.page_title,
          source_type: 'taste_search',
          source_query: q.query_text,
        })) {
          queued++;
        }
      }

      db.prepare(`
        UPDATE discover_search_queries
        SET results_fetched = ?, candidates_queued = ?, run_at = datetime('now')
        WHERE id = ?
      `).run(results.length, queued, q.id);

      console.log(`[taste-search] "${q.query_text}" → ${results.length} results, ${queued} queued`);
    } catch (err) {
      console.error(`[taste-search] query "${q.query_text}" failed:`, err.message);
    }
  }
}

module.exports = { runTasteSearch, searchUnsplash };
