const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');

const router = express.Router();

// GET /api/boards
router.get('/', (req, res) => {
  try {
    const boards = db.prepare(`
      SELECT boards.*, COUNT(images.id) as image_count
      FROM boards
      LEFT JOIN images ON images.board_id = boards.id
      GROUP BY boards.id
      ORDER BY boards.name ASC
    `).all();
    res.json(boards);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards
router.post('/', (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'name must be 100 characters or fewer' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO boards (id, name, description) VALUES (?, ?, ?)
    `).run(id, name.trim(), description || null);

    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
    res.status(201).json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/boards/:id
router.patch('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    if (name !== undefined && name.trim().length > 100) {
      return res.status(400).json({ error: 'name must be 100 characters or fewer' });
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    db.prepare(`UPDATE boards SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/boards/:id
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    db.prepare('DELETE FROM boards WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
