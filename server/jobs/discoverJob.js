'use strict';

const cron = require('node-cron');
const { db } = require('../db');
const { runDiscoverCycle, runSourceCrawler, runRssScraper } = require('../lib/crawler');
const { runTasteSearch } = require('../lib/tasteSearch');
const { scoreCandidate, generateTasteProfile } = require('../lib/scorer');

// ── Candidate scorer ───────────────────────────────────────────────
// Scores all pending candidates in batches. Runs after fetch cycles
// and also on its own schedule so candidates don't sit unscored.
async function runCandidateScorer() {
  const profile = db.prepare('SELECT * FROM taste_profile ORDER BY id DESC LIMIT 1').get();
  if (!profile) {
    console.log('[scorer] No taste profile — promoting all pending to shown');
    db.prepare("UPDATE discover_candidates SET status = 'shown' WHERE status = 'pending'").run();
    return;
  }

  const threshold = parseFloat(process.env.DISCOVER_SCORE_THRESHOLD || '6');
  const batch = db.prepare(
    "SELECT * FROM discover_candidates WHERE status = 'pending' AND score IS NULL LIMIT 50"
  ).all();

  if (batch.length === 0) return;

  console.log(`[scorer] Scoring ${batch.length} candidates...`);
  let shown = 0, dropped = 0;

  for (const candidate of batch) {
    try {
      const { score, reason } = await scoreCandidate(candidate.image_url, profile.profile_text);
      if (score >= threshold) {
        db.prepare(
          "UPDATE discover_candidates SET score = ?, score_reason = ?, status = 'shown' WHERE id = ?"
        ).run(score, reason, candidate.id);
        shown++;
      } else {
        db.prepare('DELETE FROM discover_candidates WHERE id = ?').run(candidate.id);
        dropped++;
      }
    } catch (err) {
      console.error(`[scorer] Failed to score candidate ${candidate.id}:`, err.message);
    }
  }

  console.log(`[scorer] Done — ${shown} shown, ${dropped} dropped below threshold`);
}

// ── Taste profile refresh ──────────────────────────────────────────
async function runProfileRefresh() {
  const sampleSize = parseInt(process.env.DISCOVER_SAMPLE_SIZE || '50');
  const images = db.prepare('SELECT id, filename FROM images ORDER BY RANDOM() LIMIT ?').all(sampleSize);

  if (images.length < 3) {
    console.log('[profile] Not enough images to generate profile (need at least 3)');
    return;
  }

  console.log(`[profile] Generating taste profile from ${images.length} images...`);
  try {
    const profile = await generateTasteProfile(images);
    const result = db.prepare(
      'INSERT INTO taste_profile (profile_text, sample_size, search_queries) VALUES (?, ?, ?)'
    ).run(profile.profile_text, images.length, JSON.stringify(profile.search_queries));

    for (const q of profile.search_queries) {
      db.prepare(
        'INSERT OR IGNORE INTO discover_search_queries (query_text, generated_from_profile_id) VALUES (?, ?)'
      ).run(q, result.lastInsertRowid);
    }

    console.log(`[profile] Done — ${profile.search_queries.length} search queries generated`);
  } catch (err) {
    console.error('[profile] Failed:', err.message);
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

  // RSS / scrape fetcher — every hour (internally checks per-source intervals)
  cron.schedule('0 * * * *', safe('rss-scraper', runRssScraper));

  // Taste-driven search — daily at 3am
  cron.schedule('0 3 * * *', safe('taste-search', runTasteSearch));

  // Candidate scorer — every 30 minutes (picks up anything queued by other jobs)
  cron.schedule('*/30 * * * *', safe('candidate-scorer', runCandidateScorer));

  // Taste profile refresh — weekly, Sunday at 1am (runs before other jobs so
  // taste-search at 3am uses a fresh profile the same day)
  cron.schedule('0 1 * * 0', safe('profile-refresh', runProfileRefresh));

  console.log('[jobs] Discover jobs scheduled');
}

module.exports = { startJobs, runCandidateScorer, runProfileRefresh };
