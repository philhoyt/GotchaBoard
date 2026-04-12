'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const multer = require('multer');
const { db, IMAGES_DIR, THUMBS_DIR } = require('../db');

const STORAGE_DIR = process.env.GOTCHA_STORAGE || path.join(__dirname, '..', '..', 'storage');
const DB_PATH = path.join(STORAGE_DIR, 'gotchaboard.db');

const upload = multer({ dest: path.join(STORAGE_DIR, 'temp'), limits: { fileSize: 500 * 1024 * 1024 } });

// GET /api/transfer/export  — download a .gotcha zip of all data
router.get('/export', (req, res) => {
  try {
    // Checkpoint WAL so the DB file is fully up to date
    db.pragma('wal_checkpoint(TRUNCATE)');

    const zip = new AdmZip();
    zip.addLocalFile(DB_PATH, '');

    if (fs.existsSync(IMAGES_DIR)) zip.addLocalFolder(IMAGES_DIR, 'images');
    if (fs.existsSync(THUMBS_DIR)) zip.addLocalFolder(THUMBS_DIR, 'thumbs');

    const buf = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="gotchaboard-export-${Date.now()}.gotcha"`);
    res.send(buf);
  } catch (err) {
    console.error('[transfer] Export failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transfer/import  — restore from a .gotcha zip
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const zip = new AdmZip(req.file.path);

    // Restore DB
    const dbEntry = zip.getEntry('gotchaboard.db');
    if (!dbEntry) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid export file — gotchaboard.db not found' });
    }

    // Close connections, overwrite DB, reopen is handled by process restart
    // For a live swap: write files then let the user refresh
    zip.extractEntryTo(dbEntry, STORAGE_DIR, false, true);

    // Restore images and thumbs
    zip.getEntries().forEach(entry => {
      if (entry.entryName.startsWith('images/') || entry.entryName.startsWith('thumbs/')) {
        const destDir = entry.entryName.startsWith('images/') ? IMAGES_DIR : THUMBS_DIR;
        const filename = path.basename(entry.entryName);
        if (filename) {
          fs.mkdirSync(destDir, { recursive: true });
          fs.writeFileSync(path.join(destDir, filename), entry.getData());
        }
      }
    });

    fs.unlinkSync(req.file.path);
    res.json({ ok: true, message: 'Import complete — please restart the app.' });
  } catch (err) {
    console.error('[transfer] Import failed:', err);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
