const { v4: uuidv4 } = require('uuid');
const { db } = require('../../server/db');
const { upsertTags } = require('../../server/routes/tags');

const MAX_TAG_NAME = 100;

function buildQueue(pins, { resume = false } = {}) {
  // 1. Ensure import_queue table exists with current schema.
  //    If the table exists with the old board_id schema (pre-rework), drop and recreate it.
  const tableInfo = db.prepare("PRAGMA table_info(import_queue)").all();
  if (tableInfo.length > 0) {
    const cols = tableInfo.map(c => c.name);
    const hasOldSchema = cols.includes('board_id');
    const missingHash  = !cols.includes('image_hash');
    if (hasOldSchema || missingHash) {
      const reason = hasOldSchema ? 'tag-based schema' : 'image_hash column';
      process.stderr.write(`[queueBuilder] Recreating import_queue (adding ${reason})...\n`);
      db.prepare('DROP TABLE import_queue').run();
    }
  }

  // UNIQUE(pin_url, board_name) enables INSERT OR IGNORE to skip on resume
  db.prepare(`
    CREATE TABLE IF NOT EXISTS import_queue (
      id TEXT PRIMARY KEY,
      pin_url TEXT,
      board_name TEXT NOT NULL,
      board_tag TEXT,
      tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
      title TEXT,
      source_url TEXT,
      image_hash TEXT,
      resolved_image_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      failure_reason TEXT,
      imported_at TEXT,
      UNIQUE(pin_url, board_name)
    )
  `).run();

  // 2. Resolve tags — upsert one tag per unique board name, build name→id map
  const uniqueNames = [...new Set(pins.map(p => p.board_name))];
  const tagMap = new Map(); // board_name (original case) → tag_id
  let tagsCreated = 0;

  // Count existing tags before upsert so we can report how many are new
  const countBefore = db.prepare('SELECT COUNT(*) as n FROM tags').get().n;

  const tagNames = uniqueNames.map(name =>
    name.length > MAX_TAG_NAME ? name.slice(0, MAX_TAG_NAME) : name
  );

  if (tagNames.length > 0) {
    // upsertTags normalises to lowercase and ensures rows exist
    upsertTags(tagNames);

    // Look up each tag's id by its normalised name — don't rely on return order
    const findTag = db.prepare('SELECT id FROM tags WHERE name = ?');
    for (let i = 0; i < uniqueNames.length; i++) {
      const normalized = tagNames[i].trim().toLowerCase();
      const row = findTag.get(normalized);
      if (row) tagMap.set(uniqueNames[i], row.id);
    }
  }

  const countAfter = db.prepare('SELECT COUNT(*) as n FROM tags').get().n;
  tagsCreated = countAfter - countBefore;

  // 3. Insert pins into import_queue (INSERT OR IGNORE for resume safety)
  const insertPin = db.prepare(`
    INSERT OR IGNORE INTO import_queue (id, pin_url, board_name, board_tag, tag_id, title, source_url, image_hash, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  let pinsInserted = 0;

  const insertAll = db.transaction((pins) => {
    for (const pin of pins) {
      const boardName = pin.board_name;
      const tagName   = boardName.length > MAX_TAG_NAME ? boardName.slice(0, MAX_TAG_NAME) : boardName;
      const tagId     = tagMap.get(boardName) || null;

      const result = insertPin.run(
        uuidv4(),
        pin.pin_url || null,
        boardName,
        tagName,
        tagId,
        pin.title || null,
        pin.source_url || null,
        pin.image_hash || null
      );
      if (result.changes > 0) pinsInserted++;
    }
  });

  insertAll(pins);

  // 4. Count already-done pins (relevant for --resume runs)
  const donePins = db.prepare("SELECT COUNT(*) as n FROM import_queue WHERE status = 'done'").get();
  const pinsAlreadyDone = donePins ? donePins.n : 0;

  return { tagsCreated, pinsInserted, pinsAlreadyDone };
}

module.exports = { buildQueue };
