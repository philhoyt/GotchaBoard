'use strict';

const path   = require('path');
const fs     = require('fs');
const express = require('express');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');

const { db }               = require('../db');
const { parseExport }      = require('../../import/lib/parseExport');
const { downloadImage }    = require('../lib/download');
const { generateThumbnail, thumbFilenameFor } = require('../lib/thumbnail');
const { upsertTags }       = require('./tags');

const STORAGE_DIR = process.env.GOTCHA_STORAGE || path.join(__dirname, '..', '..', 'storage');

const upload = multer({
  dest: path.join(STORAGE_DIR, 'temp'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

const router = express.Router();

// In-memory job store — fine for single-user self-hosted app
const importJobs = new Map();

// ── Helpers ───────────────────────────────────────────────────────

function hashToUrl(hash) {
  return `https://i.pinimg.com/originals/${hash.slice(0,2)}/${hash.slice(2,4)}/${hash.slice(4,6)}/${hash}.jpg`;
}

function formatDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? raw : d.toISOString();
}

// ── POST /upload ──────────────────────────────────────────────────
// Accepts a Pinterest export ZIP, parses it, returns stats + job ID.
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  // multer strips the extension — restore it so parseExport can dispatch correctly
  const origExt    = path.extname(req.file.originalname || '').toLowerCase() || '.zip';
  const parsePath  = req.file.path + origExt;
  try { fs.renameSync(req.file.path, parsePath); } catch (_) {}

  let pins;
  try {
    pins = parseExport(parsePath);
  } catch (err) {
    try { fs.unlinkSync(parsePath); } catch (_) {}
    return res.status(400).json({ error: err.message });
  }

  const jobId  = uuidv4();
  const boards = [...new Set(pins.map(p => p.board_name))].sort();

  importJobs.set(jobId, {
    id:       jobId,
    pins,
    filePath: parsePath,
    status:   'parsed',
    progress: { done: 0, failed: 0, skipped: 0, no_hash: 0, total: pins.length },
    cancelled: false,
    error:    null,
  });

  res.json({
    job_id:     jobId,
    total_pins: pins.length,
    boards:     boards.map(b => ({
      name:  b,
      count: pins.filter(p => p.board_name === b).length,
    })),
  });
});

// ── POST /start ───────────────────────────────────────────────────
// Kicks off the background import; returns immediately.
router.post('/start', (req, res) => {
  const { job_id } = req.body;
  const job = importJobs.get(job_id);
  if (!job)                   return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'running') return res.status(409).json({ error: 'Already running' });

  job.status = 'running';

  runImport(job).catch(err => {
    console.error('[import] Fatal error:', err);
    job.status = 'error';
    job.error  = err.message;
  });

  res.json({ message: 'Import started', total: job.pins.length });
});

// ── GET /progress/:jobId ──────────────────────────────────────────
// Server-Sent Events stream — sends a progress JSON every 500 ms.
router.get('/progress/:jobId', (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = () => {
    res.write(`data: ${JSON.stringify({
      status: job.status,
      ...job.progress,
      error: job.error || null,
    })}\n\n`);
  };

  send(); // immediate first update

  const interval = setInterval(() => {
    send();
    if (['done', 'error', 'cancelled'].includes(job.status)) {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on('close', () => clearInterval(interval));
});

// ── POST /cancel ──────────────────────────────────────────────────
router.post('/cancel', (req, res) => {
  const { job_id } = req.body;
  const job = importJobs.get(job_id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.cancelled = true;
  res.json({ message: 'Cancel requested' });
});

// ── GET /status ───────────────────────────────────────────────────
// Lightweight poll endpoint — useful when SSE reconnects after page reload.
router.get('/status', (req, res) => {
  // Return any active (running or recently-finished) job
  for (const [id, job] of importJobs) {
    if (['running', 'done', 'cancelled', 'error'].includes(job.status)) {
      return res.json({
        job_id:   id,
        status:   job.status,
        progress: job.progress,
        error:    job.error || null,
      });
    }
  }
  res.json({ job_id: null });
});

// ── Background import processor ───────────────────────────────────
async function runImport(job) {
  const { pins } = job;

  // Phase 1: Create tags from board names
  const uniqueBoards = [...new Set(pins.map(p => p.board_name))];
  upsertTags(uniqueBoards);

  const tagMap  = new Map();
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  for (const board of uniqueBoards) {
    const row = findTag.get(board.trim().toLowerCase());
    if (row) tagMap.set(board, row.id);
  }

  // Phase 2: Process each pin sequentially with a small politeness delay
  for (const pin of pins) {
    if (job.cancelled) {
      job.status = 'cancelled';
      cleanupJob(job);
      return;
    }

    // Pins without a valid image hash cannot be resolved without Puppeteer
    if (!pin.image_hash || !/^[a-f0-9]{32}$/i.test(pin.image_hash)) {
      job.progress.no_hash++;
      continue;
    }

    const imageUrl = hashToUrl(pin.image_hash.toLowerCase());

    // Duplicate check
    const dup = db.prepare('SELECT 1 FROM images WHERE source_url = ? LIMIT 1').get(imageUrl);
    if (dup) {
      job.progress.skipped++;
      continue;
    }

    try {
      const { filename, filepath } = await downloadImage(imageUrl);
      const thumbFilename = thumbFilenameFor(filename);
      const thumbnail     = await generateThumbnail(filepath, thumbFilename);
      const imageId       = uuidv4();
      const tagId         = tagMap.get(pin.board_name) || null;
      const savedAt       = formatDate(pin.created_at) || new Date().toISOString();

      db.transaction(() => {
        db.prepare(`
          INSERT INTO images
            (id, filename, thumbnail, source_url, page_title, page_url, pin_url, alt_text, saved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          imageId,
          filename,
          thumbnail,
          imageUrl,
          pin.title || pin.alt_text || null,
          pin.source_url || null,        // canonical article URL
          pin.pin_url    || null,        // pinterest.com/pin/… permalink
          pin.alt_text   || null,
          savedAt
        );
        if (tagId) {
          db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)')
            .run(imageId, tagId);
        }
      })();

      job.progress.done++;
    } catch (err) {
      job.progress.failed++;
      console.error(`[import] ${pin.pin_url || '(no url)'}: ${err.message}`);
    }

    // ~200 ms politeness throttle for i.pinimg.com
    await new Promise(r => setTimeout(r, 200));
  }

  job.status = 'done';
  cleanupJob(job);
}

function cleanupJob(job) {
  if (job.filePath) {
    try { fs.unlinkSync(job.filePath); } catch (_) {}
    job.filePath = null;
  }
  // Keep job in Map for 30 min so the frontend can read the final status
  setTimeout(() => importJobs.delete(job.id), 30 * 60 * 1000);
}

module.exports = router;
