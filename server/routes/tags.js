const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, generateUniqueSlug } = require('../db');

const router = express.Router();

// ── GET /api/tags ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const tags = db.prepare(`
      SELECT
        t.*,
        COUNT(it.image_id) as count,
        p.name as parent_name,
        p.slug as parent_slug
      FROM tags t
      LEFT JOIN image_tags it ON it.tag_id = t.id
      LEFT JOIN tags p ON p.id = t.parent_id
      GROUP BY t.id
      ORDER BY p.name ASC NULLS FIRST, t.name ASC
    `).all();
    res.json(tags);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/tags ─────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { name, parent_id, color } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const trimmed = name.trim().toLowerCase();

    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmed);
    if (existing) return res.status(409).json({ error: 'Tag already exists', id: existing.id });

    if (parent_id) {
      const parent = db.prepare('SELECT id, parent_id FROM tags WHERE id = ?').get(parent_id);
      if (!parent) return res.status(400).json({ error: 'parent_id not found' });
      if (parent.parent_id) return res.status(400).json({ error: 'Tags can only be one level deep' });
    }

    const id = uuidv4();
    const slug = generateUniqueSlug(trimmed);
    db.prepare('INSERT INTO tags (id, name, slug, parent_id, color) VALUES (?, ?, ?, ?, ?)').run(
      id, trimmed, slug, parent_id || null, color || null
    );

    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    res.status(201).json(tag);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/tags/:id ────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });

    const { name, parent_id, color } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) {
      const trimmed = name.trim().toLowerCase();
      if (!trimmed) return res.status(400).json({ error: 'name cannot be empty' });
      const conflict = db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(trimmed, id);
      if (conflict) return res.status(409).json({ error: 'Tag name already in use' });
      const slug = generateUniqueSlug(trimmed, id);
      updates.push('name = ?', 'slug = ?');
      params.push(trimmed, slug);
    }

    if ('parent_id' in req.body) {
      if (parent_id) {
        const parent = db.prepare('SELECT id, parent_id FROM tags WHERE id = ?').get(parent_id);
        if (!parent) return res.status(400).json({ error: 'parent_id not found' });
        if (parent.parent_id) return res.status(400).json({ error: 'Tags can only be one level deep' });
        if (parent_id === id) return res.status(400).json({ error: 'Tag cannot be its own parent' });
        // Prevent making a parent into a child if it has children
        const hasChildren = db.prepare('SELECT id FROM tags WHERE parent_id = ?').get(id);
        if (hasChildren) return res.status(400).json({ error: 'Cannot nest a tag that has children' });
      }
      updates.push('parent_id = ?');
      params.push(parent_id || null);
    }

    if ('color' in req.body) {
      updates.push('color = ?');
      params.push(color || null);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/tags/:id/merge ───────────────────────────────────────
// Merges :id into targetId — all images retagged to target, source deleted
router.post('/:id/merge', (req, res) => {
  try {
    const { id } = req.params;
    const { target_id } = req.body;

    if (!target_id) return res.status(400).json({ error: 'target_id is required' });
    if (id === target_id) return res.status(400).json({ error: 'Cannot merge a tag into itself' });

    const source = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    const target = db.prepare('SELECT * FROM tags WHERE id = ?').get(target_id);
    if (!source) return res.status(404).json({ error: 'Source tag not found' });
    if (!target) return res.status(404).json({ error: 'Target tag not found' });

    const merge = db.transaction(() => {
      // Move all source image_tags to target (INSERT OR IGNORE handles existing target tags)
      const sourceImages = db.prepare('SELECT image_id FROM image_tags WHERE tag_id = ?').all(id);
      for (const { image_id } of sourceImages) {
        db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(image_id, target_id);
      }

      // Reparent any child tags of source to target
      db.prepare('UPDATE tags SET parent_id = ? WHERE parent_id = ?').run(target_id, id);

      // Delete source tag (CASCADE removes image_tags for source)
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    });

    merge();

    const updated = db.prepare('SELECT * FROM tags WHERE id = ?').get(target_id);
    res.json({ success: true, tag: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/tags/:id ───────────────────────────────────────────
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });

    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Helper: upsert tags by name ────────────────────────────────────
function upsertTags(tagNames) {
  const normalized = tagNames
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);

  if (normalized.length === 0) return [];

  const insert = db.prepare('INSERT OR IGNORE INTO tags (id, name, slug) VALUES (?, ?, ?)');
  for (const name of normalized) {
    // Only generate slug if tag doesn't exist yet
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
    if (!existing) {
      const slug = generateUniqueSlug(name);
      insert.run(uuidv4(), name, slug);
    }
  }

  const placeholders = normalized.map(() => '?').join(', ');
  const rows = db.prepare(`SELECT id FROM tags WHERE name IN (${placeholders})`).all(...normalized);
  return rows.map(r => r.id);
}

module.exports = router;
module.exports.upsertTags = upsertTags;
