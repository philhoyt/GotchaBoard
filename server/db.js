const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// In dev: ./storage/ (project root). In packaged Electron: userData/storage/.
const STORAGE_DIR = process.env.GOTCHA_STORAGE || path.join(__dirname, '..', 'storage');
const IMAGES_DIR = path.join(STORAGE_DIR, 'images');
const THUMBS_DIR = path.join(STORAGE_DIR, 'thumbs');
const DB_PATH = path.join(STORAGE_DIR, 'gotchaboard.db');

fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(THUMBS_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Base tables ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    thumbnail TEXT NOT NULL,
    source_url TEXT NOT NULL,
    page_title TEXT,
    page_url TEXT,
    saved_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT,
    parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
    color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS image_tags (
    image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (image_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS smart_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tag_query TEXT NOT NULL DEFAULT '{"operator":"AND","tags":[]}',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id);
  CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id);

  CREATE TABLE IF NOT EXISTS discover_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('rss', 'scrape')),
    fetch_interval_hours INTEGER NOT NULL DEFAULT 24,
    last_fetched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS discover_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL UNIQUE,
    page_url TEXT,
    page_title TEXT,
    source_type TEXT NOT NULL CHECK(source_type IN ('crawl','rss','link_hop')),
    source_id INTEGER REFERENCES discover_sources(id) ON DELETE SET NULL,
    source_query TEXT,
    source_image_id TEXT REFERENCES images(id) ON DELETE SET NULL,
    score REAL,
    score_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','shown','saved','dismissed')),
    discovered_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS discover_link_hops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    found_from_url TEXT,
    images_found INTEGER NOT NULL DEFAULT 0,
    candidates_queued INTEGER NOT NULL DEFAULT 0,
    crawled_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_candidates_status   ON discover_candidates(status);
  CREATE INDEX IF NOT EXISTS idx_candidates_score    ON discover_candidates(score DESC);
  CREATE INDEX IF NOT EXISTS idx_candidates_image_url ON discover_candidates(image_url);
`);

// ── Migrations ─────────────────────────────────────────────────────

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tag';
}

function generateUniqueSlug(name, excludeId = null) {
  const base = slugify(name);
  let slug = base;
  let n = 2;
  while (true) {
    const existing = db.prepare('SELECT id FROM tags WHERE slug = ?').get(slug);
    if (!existing || existing.id === excludeId) break;
    slug = `${base}-${n++}`;
  }
  return slug;
}

function runMigrations() {
  // Remove taste profile tables (feature removed)
  db.prepare('DROP TABLE IF EXISTS discover_search_queries').run();
  db.prepare('DROP TABLE IF EXISTS taste_profile').run();

  // Remove taste-related candidates from existing databases
  db.prepare("DELETE FROM discover_candidates WHERE source_type IN ('taste_search', 'visual_sim')").run();

  // 1. Add columns to tags table if upgrading from V1 schema
  const tagCols = db.prepare('PRAGMA table_info(tags)').all().map(c => c.name);
  if (!tagCols.includes('slug'))       db.prepare('ALTER TABLE tags ADD COLUMN slug TEXT').run();
  if (!tagCols.includes('parent_id'))  db.prepare('ALTER TABLE tags ADD COLUMN parent_id TEXT REFERENCES tags(id) ON DELETE SET NULL').run();
  if (!tagCols.includes('color'))      db.prepare('ALTER TABLE tags ADD COLUMN color TEXT').run();
  if (!tagCols.includes('created_at')) {
    db.prepare('ALTER TABLE tags ADD COLUMN created_at TEXT').run();
    db.prepare("UPDATE tags SET created_at = datetime('now') WHERE created_at IS NULL").run();
  }

  // Ensure indexes exist now that columns are guaranteed present
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS idx_tags_parent_id ON tags(parent_id)').run();

  // Populate slugs for any tags that don't have one yet
  const unsluggedTags = db.prepare('SELECT id, name FROM tags WHERE slug IS NULL').all();
  for (const tag of unsluggedTags) {
    const slug = generateUniqueSlug(tag.name, tag.id);
    db.prepare('UPDATE tags SET slug = ? WHERE id = ?').run(slug, tag.id);
  }

  // 2. Migrate boards → tags if the boards table still exists
  const hasBoardsTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'").get();
  if (hasBoardsTable) {
    console.log('[db] Migrating boards to tags...');
    const boards = db.prepare('SELECT * FROM boards').all();

    const migrate = db.transaction(() => {
      for (const board of boards) {
        let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(board.name);
        if (!tag) {
          const tagId = uuidv4();
          const slug = generateUniqueSlug(board.name);
          db.prepare('INSERT INTO tags (id, name, slug) VALUES (?, ?, ?)').run(tagId, board.name, slug);
          tag = { id: tagId };
        }
        // Convert images.board_id references to image_tags rows
        const images = db.prepare('SELECT id FROM images WHERE board_id = ?').all(board.id);
        for (const img of images) {
          db.prepare('INSERT OR IGNORE INTO image_tags (image_id, tag_id) VALUES (?, ?)').run(img.id, tag.id);
        }
      }
      db.prepare('DROP TABLE IF EXISTS boards').run();
    });

    migrate();
    console.log('[db] Board migration complete.');
  }

  // 3. Add import-enriched columns to images if upgrading from earlier schema
  const imageCols2 = db.prepare('PRAGMA table_info(images)').all().map(c => c.name);
  if (!imageCols2.includes('pin_url'))  db.prepare('ALTER TABLE images ADD COLUMN pin_url TEXT').run();
  if (!imageCols2.includes('alt_text')) db.prepare('ALTER TABLE images ADD COLUMN alt_text TEXT').run();

  // 4. Drop board_id from images if it still exists (SQLite 3.35+)
  const imageCols = db.prepare('PRAGMA table_info(images)').all().map(c => c.name);
  if (imageCols.includes('board_id')) {
    // Drop any index that references board_id before dropping the column
    const boardIdIndexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='images' AND sql LIKE '%board_id%'"
    ).all();
    for (const idx of boardIdIndexes) {
      db.prepare(`DROP INDEX IF EXISTS "${idx.name}"`).run();
    }
    db.prepare('ALTER TABLE images DROP COLUMN board_id').run();
  }
}

runMigrations();

module.exports = { db, IMAGES_DIR, THUMBS_DIR, generateUniqueSlug, slugify };
