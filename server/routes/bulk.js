const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, IMAGES_DIR, THUMBS_DIR } = require('../db');
const { upsertTags } = require('./tags');

const router = express.Router();

const VALID_ACTIONS = ['add_tags', 'remove_tags', 'move_to_tags', 'delete'];

// POST /api/gots/bulk
router.post('/', (req, res) => {
  try {
    const { ids, action, tags = [] } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (!VALID_ACTIONS.includes(action)) {
      return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
    }
    if (['add_tags', 'remove_tags', 'move_to_tags'].includes(action) && tags.length === 0) {
      return res.status(400).json({ error: 'tags is required for this action' });
    }

    // Verify all images exist
    const placeholders = ids.map(() => '?').join(',');
    const existing = db.prepare(`SELECT id FROM images WHERE id IN (${placeholders})`).all(...ids);
    if (existing.length !== ids.length) {
      return res.status(400).json({ error: 'One or more image IDs not found' });
    }

    let affected = 0;

    if (action === 'add_tags') {
      const tagIds = upsertTags(tags);
      const insertTag = db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)');
      const addAll = db.transaction(() => {
        for (const imageId of ids) {
          for (const tagId of tagIds) {
            const result = insertTag.run(imageId, tagId);
            affected += result.changes;
          }
        }
      });
      addAll();
    }

    else if (action === 'remove_tags') {
      const tagNames = tags.map(t => t.trim().toLowerCase()).filter(Boolean);
      if (tagNames.length > 0) {
        const ph = tagNames.map(() => '?').join(',');
        const tagRows = db.prepare(`SELECT id FROM tags WHERE name IN (${ph})`).all(...tagNames);
        const tagIds = tagRows.map(r => r.id);
        const removeTag = db.prepare('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?');
        const removeAll = db.transaction(() => {
          for (const imageId of ids) {
            for (const tagId of tagIds) {
              const result = removeTag.run(imageId, tagId);
              affected += result.changes;
            }
          }
        });
        removeAll();
      }
    }

    else if (action === 'move_to_tags') {
      const tagIds = upsertTags(tags);
      const moveAll = db.transaction(() => {
        for (const imageId of ids) {
          db.prepare('DELETE FROM image_tags WHERE image_id = ?').run(imageId);
          for (const tagId of tagIds) {
            db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(imageId, tagId);
          }
          affected++;
        }
      });
      moveAll();
    }

    else if (action === 'delete') {
      const deleteAll = db.transaction(() => {
        for (const imageId of ids) {
          const image = db.prepare('SELECT * FROM images WHERE id = ?').get(imageId);
          if (!image) continue;
          db.prepare('DELETE FROM images WHERE id = ?').run(imageId);
          try { fs.unlinkSync(path.join(IMAGES_DIR, image.filename)); } catch (_) {}
          if (image.thumbnail && image.thumbnail !== 'error' && image.thumbnail !== 'placeholder') {
            try { fs.unlinkSync(path.join(THUMBS_DIR, image.thumbnail)); } catch (_) {}
          }
          affected++;
        }
      });
      deleteAll();
    }

    res.json({ success: true, affected });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
