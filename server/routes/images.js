const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const { db, IMAGES_DIR, THUMBS_DIR } = require('../db');
const { downloadImage } = require('../lib/download');
const { generateThumbnail, thumbFilenameFor } = require('../lib/thumbnail');
const { extFromMime, SHARP_SUPPORTED } = require('../lib/formats');
const { upsertTags } = require('./tags');

async function readDimensions(filepath) {
  try {
    const { width, height } = await sharp(filepath).metadata();
    if (width && height) return { width, height };
  } catch (_) {}

  // Fallback for SVGs — parse viewBox or width/height from the XML header
  if (filepath.toLowerCase().endsWith('.svg')) {
    try {
      const head = fs.readFileSync(filepath, 'utf8').slice(0, 2000);
      const vb = head.match(/viewBox=["'][\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)["']/);
      if (vb) return { width: Math.round(parseFloat(vb[1])), height: Math.round(parseFloat(vb[2])) };
      const w = head.match(/\bwidth=["']([\d.]+)/);
      const h = head.match(/\bheight=["']([\d.]+)/);
      if (w && h) return { width: Math.round(parseFloat(w[1])), height: Math.round(parseFloat(h[1])) };
    } catch (_) {}
  }

  return { width: null, height: null };
}

const router = express.Router();

function rowToImage(row) {
  if (!row) return null;
  const { tag_names, ...rest } = row;
  return { ...rest, tags: tag_names ? tag_names.split('|') : [] };
}

const BASE_QUERY = `
  SELECT
    images.*,
    GROUP_CONCAT(tags.name, '|') as tag_names
  FROM images
  LEFT JOIN image_tags ON image_tags.image_id = images.id
  LEFT JOIN tags ON tags.id = image_tags.tag_id
`;

// ── POST /api/images/upload ────────────────────────────────────────
// Mounted directly in index.js with multer middleware
async function handleUpload(req, res) {
  const tempPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const mime = req.file.mimetype || '';
    if (!mime.startsWith('image/')) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({ error: 'File must be an image' });
    }

    const ext = extFromMime(mime) || path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const filename = `${uuidv4()}${ext}`;
    const destPath = path.join(IMAGES_DIR, filename);

    // Sharp-safe formats: normalise EXIF orientation.
    // GIF (multi-frame) and SVG (vector) are copied as-is.
    if (SHARP_SUPPORTED.has(mime)) {
      await sharp(tempPath).rotate().toFile(destPath);
      fs.unlinkSync(tempPath);
    } else {
      fs.renameSync(tempPath, destPath);
    }

    const thumbFilename = thumbFilenameFor(filename);
    const thumbnail = await generateThumbnail(destPath, thumbFilename);
    const { width, height } = await readDimensions(destPath);

    const imageId = uuidv4();
    const rawTags = req.body.tags ? JSON.parse(req.body.tags) : [];
    const tagIds = Array.isArray(rawTags) && rawTags.length > 0 ? upsertTags(rawTags) : [];
    const notes = req.body.notes || null;
    const page_title = req.body.page_title || req.file.originalname || null;
    const page_url = req.body.page_url || null;
    const source_url = 'local://upload';

    db.transaction(() => {
      db.prepare(`
        INSERT INTO images (id, filename, thumbnail, source_url, page_title, page_url, notes, width, height)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(imageId, filename, thumbnail, source_url, page_title, page_url, notes, width, height);
      for (const tagId of tagIds) {
        db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(imageId, tagId);
      }
    })();

    const saved = db.prepare(`${BASE_QUERY} WHERE images.id = ? GROUP BY images.id`).get(imageId);
    res.status(201).json(rowToImage(saved));
  } catch (err) {
    if (tempPath) try { fs.unlinkSync(tempPath); } catch (_) {}
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.handleUpload = handleUpload;

// Build WHERE clauses for image filtering
function buildImageFilter(query) {
  const where = [];
  const params = [];
  const { tag, tags, tag_id, untagged, q, collection } = query;

  // Single tag filter — includes parent + all its children
  if (tag) {
    where.push(`images.id IN (
      SELECT it2.image_id FROM image_tags it2
      JOIN tags t2 ON t2.id = it2.tag_id
      WHERE t2.name = ? OR t2.parent_id = (SELECT id FROM tags WHERE name = ? LIMIT 1)
    )`);
    const tagName = tag.toLowerCase();
    params.push(tagName, tagName);
  }

  // Multi-tag OR filter (comma-separated names) — sidebar checkbox selection
  if (tags && !tag) {
    const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tagList.length > 0) {
      where.push(`images.id IN (
        SELECT DISTINCT image_id FROM image_tags it3
        JOIN tags t3 ON t3.id = it3.tag_id
        WHERE t3.name IN (${tagList.map(() => '?').join(',')})
      )`);
      params.push(...tagList);
    }
  }

  // Multi-tag AND filter (for collection preview — ?tags_and=name1,name2)
  if (query.tags_and) {
    const tagList = query.tags_and.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (tagList.length > 0) {
      where.push(`images.id IN (
        SELECT image_id FROM image_tags it_and
        JOIN tags t_and ON t_and.id = it_and.tag_id
        WHERE t_and.name IN (${tagList.map(() => '?').join(',')})
        GROUP BY image_id HAVING COUNT(DISTINCT t_and.name) = ?
      )`);
      params.push(...tagList, tagList.length);
    }
  }

  // Filter by tag ID (e.g. from sidebar click — includes children)
  if (tag_id) {
    where.push(`images.id IN (
      SELECT it4.image_id FROM image_tags it4
      JOIN tags t4 ON t4.id = it4.tag_id
      WHERE t4.id = ? OR t4.parent_id = ?
    )`);
    params.push(tag_id, tag_id);
  }

  // Untagged filter
  if (untagged === '1' || untagged === 'true') {
    where.push(`images.id NOT IN (SELECT DISTINCT image_id FROM image_tags)`);
  }

  // Smart collection filter
  if (collection) {
    const col = db.prepare('SELECT tag_query FROM smart_collections WHERE id = ?').get(collection);
    if (col) {
      const { operator = 'AND', tags: colTags = [], exclude_tags = [] } = JSON.parse(col.tag_query);
      if (colTags.length > 0) {
        if (operator === 'AND') {
          where.push(`images.id IN (
            SELECT image_id FROM image_tags itc
            JOIN tags tc ON tc.id = itc.tag_id
            WHERE tc.name IN (${colTags.map(() => '?').join(',')})
            GROUP BY image_id HAVING COUNT(DISTINCT tc.name) = ?
          )`);
          params.push(...colTags, colTags.length);
        } else {
          where.push(`images.id IN (
            SELECT image_id FROM image_tags itc
            JOIN tags tc ON tc.id = itc.tag_id
            WHERE tc.name IN (${colTags.map(() => '?').join(',')})
          )`);
          params.push(...colTags);
        }
      }
      if (exclude_tags.length > 0) {
        where.push(`images.id NOT IN (
          SELECT image_id FROM image_tags ite
          JOIN tags te ON te.id = ite.tag_id
          WHERE te.name IN (${exclude_tags.map(() => '?').join(',')})
        )`);
        params.push(...exclude_tags);
      }
    }
  }

  // Full-text search
  if (q) {
    where.push('(images.page_title LIKE ? OR images.notes LIKE ? OR images.source_url LIKE ?)');
    const term = `%${q}%`;
    params.push(term, term, term);
  }

  return { where, params };
}

// ── GET /api/images/check-duplicate ───────────────────────────────
router.get('/check-duplicate', (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.json({ duplicate: false });
    const row = db.prepare('SELECT id FROM images WHERE source_url = ? LIMIT 1').get(url);
    res.json(row ? { duplicate: true, id: row.id } : { duplicate: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/images/save ──────────────────────────────────────────
router.post('/save', async (req, res) => {
  try {
    const { source_url, page_title, page_url, tags, notes } = req.body;

    if (!source_url) return res.status(400).json({ error: 'source_url is required' });
    try { new URL(source_url); } catch (_) {
      return res.status(400).json({ error: 'source_url is not a valid URL' });
    }

    let filename, filepath;
    try {
      ({ filename, filepath } = await downloadImage(source_url));
    } catch (err) {
      return res.status(400).json({ error: `Failed to download image: ${err.message}` });
    }

    const thumbFilename = thumbFilenameFor(filename);
    const thumbnail = await generateThumbnail(filepath, thumbFilename);
    const { width, height } = await readDimensions(filepath);

    const imageId = uuidv4();
    const tagIds = Array.isArray(tags) && tags.length > 0 ? upsertTags(tags) : [];

    const saveTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO images (id, filename, thumbnail, source_url, page_title, page_url, notes, width, height)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(imageId, filename, thumbnail, source_url, page_title || null, page_url || null, notes || null, width, height);

      for (const tagId of tagIds) {
        db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(imageId, tagId);
      }
    });

    saveTransaction();

    const saved = db.prepare(`${BASE_QUERY} WHERE images.id = ? GROUP BY images.id`).get(imageId);
    res.status(201).json(rowToImage(saved));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/images ────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { where, params } = buildImageFilter(req.query);
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const limit  = Math.min(Math.max(parseInt(req.query.limit)  || 60, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const total = db.prepare(
      `SELECT COUNT(DISTINCT images.id) as c FROM images ${whereClause}`
    ).get(...params).c;

    const query = `${BASE_QUERY} ${whereClause} GROUP BY images.id ORDER BY images.saved_at DESC LIMIT ? OFFSET ?`;
    const images = db.prepare(query).all(...params, limit, offset).map(rowToImage);

    res.json({ images, total, limit, offset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/images/counts ────────────────────────────────────────
router.get('/counts', (req, res) => {
  try {
    const total    = db.prepare('SELECT COUNT(*) as c FROM images').get().c;
    const untagged = db.prepare('SELECT COUNT(*) as c FROM images WHERE id NOT IN (SELECT DISTINCT image_id FROM image_tags)').get().c;
    res.json({ total, untagged });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/images/:id ────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare(`${BASE_QUERY} WHERE images.id = ? GROUP BY images.id`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Image not found' });
    res.json(rowToImage(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/images/:id ──────────────────────────────────────────
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const image = db.prepare('SELECT id FROM images WHERE id = ?').get(id);
    if (!image) return res.status(404).json({ error: 'Image not found' });

    const { notes, tags, page_title } = req.body;
    const updates = [];
    const params = [];

    if (notes !== undefined)      { updates.push('notes = ?');      params.push(notes); }
    if (page_title !== undefined) { updates.push('page_title = ?'); params.push(page_title); }

    const updateTransaction = db.transaction(() => {
      if (updates.length > 0) {
        params.push(id);
        db.prepare(`UPDATE images SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
      if (Array.isArray(tags)) {
        db.prepare('DELETE FROM image_tags WHERE image_id = ?').run(id);
        const tagIds = tags.length > 0 ? upsertTags(tags) : [];
        for (const tagId of tagIds) {
          db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(id, tagId);
        }
      }
    });

    updateTransaction();

    const updated = db.prepare(`${BASE_QUERY} WHERE images.id = ? GROUP BY images.id`).get(id);
    res.json(rowToImage(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/images (all) ───────────────────────────────────────
router.delete('/', (req, res) => {
  try {
    const images = db.prepare('SELECT filename, thumbnail FROM images').all();

    db.prepare('DELETE FROM images').run();

    for (const img of images) {
      try { fs.unlinkSync(path.join(IMAGES_DIR, img.filename)); } catch (_) {}
      if (img.thumbnail && img.thumbnail !== 'error' && img.thumbnail !== 'placeholder') {
        try { fs.unlinkSync(path.join(THUMBS_DIR, img.thumbnail)); } catch (_) {}
      }
    }

    res.json({ deleted: images.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/images/:id ─────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(id);
    if (!image) return res.status(404).json({ error: 'Image not found' });

    db.prepare('DELETE FROM images WHERE id = ?').run(id);
    try { fs.unlinkSync(path.join(IMAGES_DIR, image.filename)); } catch (_) {}
    if (image.thumbnail && image.thumbnail !== 'error' && image.thumbnail !== 'placeholder') {
      try { fs.unlinkSync(path.join(THUMBS_DIR, image.thumbnail)); } catch (_) {}
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
