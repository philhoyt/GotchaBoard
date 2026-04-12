'use strict';

const express = require('express');
const { db } = require('../db');
const { downloadImage } = require('../lib/download');
const { generateThumbnail, thumbFilenameFor } = require('../lib/thumbnail');
const { upsertTags } = require('./tags');
const { runDiscoverCycle } = require('../lib/crawler');
const { promoteAllPending } = require('../jobs/discoverJob');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// ── GET /api/discover ──────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50'), 200);
    const offset = parseInt(req.query.offset || '0');

    const candidates = db.prepare(`
      SELECT * FROM discover_candidates
      WHERE status = 'shown'
      ORDER BY discovered_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(
      "SELECT COUNT(*) as n FROM discover_candidates WHERE status = 'shown'"
    ).get().n;

    const pending = db.prepare(
      "SELECT COUNT(*) as n FROM discover_candidates WHERE status = 'pending'"
    ).get().n;

    res.json({ candidates, total, pending, limit, offset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/discover/:id/save ────────────────────────────────────
router.post('/:id/save', async (req, res) => {
  try {
    const candidate = db.prepare('SELECT * FROM discover_candidates WHERE id = ?').get(req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    if (candidate.status === 'saved') return res.status(409).json({ error: 'Already saved' });

    const { tags = [], notes = null } = req.body;

    let filename, filepath;
    try {
      ({ filename, filepath } = await downloadImage(candidate.image_url));
    } catch (err) {
      return res.status(400).json({ error: `Failed to download image: ${err.message}` });
    }

    const thumbFilename = thumbFilenameFor(filename);
    const thumbnail = await generateThumbnail(filepath, thumbFilename);

    const imageId = uuidv4();
    const tagIds = Array.isArray(tags) && tags.length > 0 ? upsertTags(tags) : [];

    db.transaction(() => {
      db.prepare(`
        INSERT INTO images (id, filename, thumbnail, source_url, page_title, page_url, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(imageId, filename, thumbnail, candidate.image_url,
             candidate.page_title || null, candidate.page_url || null, notes);

      for (const tagId of tagIds) {
        db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(imageId, tagId);
      }

      db.prepare("UPDATE discover_candidates SET status = 'saved' WHERE id = ?").run(candidate.id);
    })();

    const saved = db.prepare(`
      SELECT images.*, GROUP_CONCAT(tags.name, ',') as tag_names
      FROM images
      LEFT JOIN image_tags ON image_tags.image_id = images.id
      LEFT JOIN tags ON tags.id = image_tags.tag_id
      WHERE images.id = ? GROUP BY images.id
    `).get(imageId);

    const { tag_names, ...rest } = saved;
    res.status(201).json({ ...rest, tags: tag_names ? tag_names.split(',') : [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/discover/:id/dismiss ────────────────────────────────
router.post('/:id/dismiss', (req, res) => {
  try {
    const candidate = db.prepare('SELECT id FROM discover_candidates WHERE id = ?').get(req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    db.prepare("UPDATE discover_candidates SET status = 'dismissed' WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/discover/sources ──────────────────────────────────────
router.get('/sources', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM discover_sources ORDER BY created_at DESC').all());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/discover/sources ─────────────────────────────────────
router.post('/sources', (req, res) => {
  try {
    const { url, label, type, fetch_interval_hours = 24 } = req.body;
    if (!url || !label || !type) return res.status(400).json({ error: 'url, label, and type are required' });
    if (!['rss', 'scrape'].includes(type)) return res.status(400).json({ error: 'type must be rss or scrape' });
    try { new URL(url); } catch (_) { return res.status(400).json({ error: 'Invalid URL' }); }

    const result = db.prepare(
      'INSERT INTO discover_sources (url, label, type, fetch_interval_hours) VALUES (?, ?, ?, ?)'
    ).run(url, label, type, fetch_interval_hours);

    res.status(201).json(db.prepare('SELECT * FROM discover_sources WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/discover/sources/:id ───────────────────────────────
router.patch('/sources/:id', (req, res) => {
  try {
    const source = db.prepare('SELECT * FROM discover_sources WHERE id = ?').get(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const { label, url, type, fetch_interval_hours } = req.body;
    const updates = [];
    const params = [];
    if (label !== undefined)               { updates.push('label = ?');                params.push(label); }
    if (url !== undefined)                 { updates.push('url = ?');                  params.push(url); }
    if (type !== undefined)                { updates.push('type = ?');                 params.push(type); }
    if (fetch_interval_hours !== undefined){ updates.push('fetch_interval_hours = ?'); params.push(fetch_interval_hours); }

    if (updates.length === 0) return res.json(source);
    params.push(req.params.id);
    db.prepare(`UPDATE discover_sources SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json(db.prepare('SELECT * FROM discover_sources WHERE id = ?').get(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/discover/sources/:id ──────────────────────────────
router.delete('/sources/:id', (req, res) => {
  try {
    const source = db.prepare('SELECT id FROM discover_sources WHERE id = ?').get(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    db.prepare('DELETE FROM discover_sources WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/discover/run ─────────────────────────────────────────
router.post('/run', async (req, res) => {
  try {
    res.json({ message: 'Discover cycle started' });
    runDiscoverCycle()
      .then(() => promoteAllPending())
      .catch(err => console.error('[discover] cycle error:', err));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/discover/stats ────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    const bySource = db.prepare(`
      SELECT source_type, status, COUNT(*) as n
      FROM discover_candidates
      GROUP BY source_type, status
    `).all();

    const totals = db.prepare(`
      SELECT status, COUNT(*) as n FROM discover_candidates GROUP BY status
    `).all();

    res.json({ by_source: bySource, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
