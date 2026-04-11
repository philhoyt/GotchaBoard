const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');

const router = express.Router();

function validateQuery(tag_query) {
  if (typeof tag_query !== 'object' || tag_query === null) return 'tag_query must be an object';
  if (!['AND', 'OR'].includes(tag_query.operator || 'AND')) return 'operator must be AND or OR';
  if (!Array.isArray(tag_query.tags)) return 'tags must be an array';
  return null;
}

// GET /api/smart-collections
router.get('/', (req, res) => {
  try {
    const cols = db.prepare('SELECT * FROM smart_collections ORDER BY pinned DESC, name ASC').all();
    res.json(cols.map(c => ({ ...c, tag_query: JSON.parse(c.tag_query) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/smart-collections
router.post('/', (req, res) => {
  try {
    const { name, tag_query, pinned = false } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const err = validateQuery(tag_query);
    if (err) return res.status(400).json({ error: err });

    const id = uuidv4();
    db.prepare('INSERT INTO smart_collections (id, name, tag_query, pinned) VALUES (?, ?, ?, ?)').run(
      id, name.trim(), JSON.stringify(tag_query), pinned ? 1 : 0
    );

    const col = db.prepare('SELECT * FROM smart_collections WHERE id = ?').get(id);
    res.status(201).json({ ...col, tag_query: JSON.parse(col.tag_query) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/smart-collections/:id
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const col = db.prepare('SELECT * FROM smart_collections WHERE id = ?').get(id);
    if (!col) return res.status(404).json({ error: 'Collection not found' });

    const { name, tag_query, pinned } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (tag_query !== undefined) {
      const err = validateQuery(tag_query);
      if (err) return res.status(400).json({ error: err });
      updates.push('tag_query = ?');
      params.push(JSON.stringify(tag_query));
    }
    if (pinned !== undefined) { updates.push('pinned = ?'); params.push(pinned ? 1 : 0); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    db.prepare(`UPDATE smart_collections SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM smart_collections WHERE id = ?').get(id);
    res.json({ ...updated, tag_query: JSON.parse(updated.tag_query) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/smart-collections/:id
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const col = db.prepare('SELECT id FROM smart_collections WHERE id = ?').get(id);
    if (!col) return res.status(404).json({ error: 'Collection not found' });
    db.prepare('DELETE FROM smart_collections WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
