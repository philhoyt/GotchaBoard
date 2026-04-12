const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');

// ── CSV parsing (legacy format) ────────────────────────────────────────────

function findColumn(headers, candidates) {
  const lower = headers.map(h => (h || '').toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function findPinUrlColumnByValue(headers, firstRecord) {
  for (const header of headers) {
    const val = firstRecord[header] || '';
    if (/pinterest\.com\/pin\//i.test(val)) return header;
  }
  return null;
}

function parseCsvBuffer(buf) {
  const records = parse(buf, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });

  if (!records.length) throw new Error('CSV is empty');

  const headers = Object.keys(records[0]);

  const boardCol  = findColumn(headers, ['board name', 'board', 'board title']);
  const titleCol  = findColumn(headers, ['title', 'pin title', 'pin name']);
  const noteCol   = findColumn(headers, ['note', 'description', 'notes']);
  const linkCol   = findColumn(headers, ['link', 'source url', 'source', 'original link']);
  let   pinUrlCol = findColumn(headers, ['pin url', 'pin link', 'url']);

  if (!pinUrlCol) pinUrlCol = findPinUrlColumnByValue(headers, records[0]);

  if (!boardCol) {
    throw new Error(
      `Could not find board name column in CSV headers: [${headers.join(', ')}]\n` +
      `Is this a Pinterest export?`
    );
  }

  const pins = [];
  let skipped = 0;

  for (const row of records) {
    const pinUrl   = pinUrlCol ? (row[pinUrlCol] || '').trim() : '';
    const boardName = (row[boardCol] || '').trim();

    if (!boardName) { skipped++; continue; }

    if (pinUrlCol && pinUrl && !/pinterest\.com\/pin\//i.test(pinUrl)) {
      skipped++;
      continue;
    }

    pins.push({
      pin_url:    pinUrl || null,
      board_name: boardName,
      title:      titleCol ? (row[titleCol]  || '').trim() || null : null,
      note:       noteCol  ? (row[noteCol]   || '').trim() || null : null,
      source_url: linkCol  ? (row[linkCol]   || '').trim() || null : null,
    });
  }

  if (skipped > 0) {
    process.stderr.write(`[parseExport] Skipped ${skipped} rows with missing board name or invalid pin URL\n`);
  }

  if (!pins.length) throw new Error('No valid pins found in CSV');

  return pins;
}

// ── HTML parsing (current Pinterest SAR export format) ─────────────────────
//
// Each pin in pins/NNNN.html looks like:
//
//   <a href="https://www.pinterest.com/pin/ID/">URL</a>
//   <br>
//   Title: ... <br>
//   Details: ... <br>
//   Board Name: BOARDNAME <br>
//   Canonical Link: <a href="URL">URL</a>  OR  No data
//   <br>
//   <br>

function getField(block, name) {
  // Match "Field Name: value <br>" — value may contain HTML (e.g. Canonical Link)
  const re = new RegExp(name.replace(/\s/g, '\\s+') + ':\\s*(.*?)(?=\\s*<br>|$)', 'i');
  const m = block.match(re);
  if (!m) return null;
  // Strip any HTML tags from value, then trim
  let val = m[1].replace(/<[^>]+>/g, '').trim();
  return val.toLowerCase() === 'no data' || val === '' ? null : val;
}

function getCanonicalLink(block) {
  // Canonical Link may be a plain <a href> or plain text "No data"
  const m = block.match(/Canonical Link:\s*<a\s+href="([^"]+)"/i);
  return m ? m[1] : null;
}

function parseHtmlPinBlocks(html) {
  const pins = [];
  let videoSkipped = 0;
  let deadSkipped  = 0;

  // Pin header lines look like:
  //   (whitespace)<a href="https://www.pinterest.com/pin/ID/">URL</a>(whitespace)
  // They are on their own line — canonical links are preceded by "Canonical Link:"
  // so they won't match this pattern.
  const pinHeaderRe = /^[ \t]*<a href="(https:\/\/www\.pinterest\.com\/pin\/[^"]+)">[^<]+<\/a>[ \t]*$/gm;

  const matches = [];
  let m;
  while ((m = pinHeaderRe.exec(html)) !== null) {
    matches.push({ pinUrl: m[1], blockStart: m.index + m[0].length });
  }

  for (let i = 0; i < matches.length; i++) {
    const blockEnd = i + 1 < matches.length ? matches[i + 1].blockStart : html.length;
    const block    = html.slice(matches[i].blockStart, blockEnd);

    const rawHash = getField(block, 'Image');
    const image_hash = rawHash && /^[a-f0-9]{32}$/i.test(rawHash) ? rawHash.toLowerCase() : null;

    const pin = {
      pin_url:    matches[i].pinUrl,
      board_name: getField(block, 'Board Name'),
      title:      getField(block, 'Title'),
      note:       getField(block, 'Details'),
      source_url: getCanonicalLink(block) || getField(block, 'Canonical Link'),
      image_hash,
      alt_text:   getField(block, 'Alt Text'),
      is_video:   getField(block, 'Is Video') === 'Yes',
      alive:      getField(block, 'Alive') !== 'No',
      created_at: getField(block, 'Created at'),
    };

    if (!pin.board_name)  continue;
    if (pin.is_video)     { videoSkipped++; continue; }
    if (!pin.alive)       { deadSkipped++;  continue; }
    pins.push(pin);
  }

  if (videoSkipped) process.stderr.write(`[parseExport] Skipped ${videoSkipped} video pins\n`);
  if (deadSkipped)  process.stderr.write(`[parseExport] Skipped ${deadSkipped} dead pins\n`);

  return pins;
}

function parseHtmlBuffers(buffers) {
  const pins = [];
  for (const buf of buffers) {
    const html = buf.toString('utf8');
    pins.push(...parseHtmlPinBlocks(html));
  }
  if (!pins.length) throw new Error('No valid pins found in HTML export');
  return pins;
}

// ── ZIP helpers ─────────────────────────────────────────────────────────────

function findCsvInZip(zip) {
  const entries = zip.getEntries();
  const preferred = entries.find(e => path.basename(e.entryName).toLowerCase() === 'pins.csv');
  if (preferred) return preferred;
  return entries.find(e => e.entryName.toLowerCase().endsWith('.csv') && !e.isDirectory) || null;
}

function findPinHtmlsInZip(zip) {
  // pins/0001.html, pins/0002.html, …  (skip the index pins/your_pins.html)
  return zip.getEntries()
    .filter(e => /^pins\/\d+\.html$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
}

// ── Public entry point ──────────────────────────────────────────────────────

function parseExport(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.zip') {
    const zip = new AdmZip(filePath);

    // Prefer CSV if present (legacy format)
    const csvEntry = findCsvInZip(zip);
    if (csvEntry) return parseCsvBuffer(csvEntry.getData());

    // Fall back to current HTML export format
    const htmlEntries = findPinHtmlsInZip(zip);
    if (htmlEntries.length > 0) {
      return parseHtmlBuffers(htmlEntries.map(e => e.getData()));
    }

    throw new Error(
      'No pin data found in ZIP archive.\n' +
      'Expected either a pins.csv file or a pins/0001.html (Pinterest SAR export).'
    );
  }

  if (ext === '.csv') {
    return parseCsvBuffer(fs.readFileSync(filePath));
  }

  if (ext === '.html') {
    return parseHtmlBuffers([fs.readFileSync(filePath)]);
  }

  if (fs.statSync(filePath).isDirectory()) {
    // CSV in directory
    const csvFile = fs.readdirSync(filePath).find(f => f.toLowerCase().endsWith('.csv'));
    if (csvFile) return parseCsvBuffer(fs.readFileSync(path.join(filePath, csvFile)));

    // HTML pin pages in directory
    const htmlFiles = fs.readdirSync(filePath)
      .filter(f => /^\d+\.html$/i.test(f))
      .sort()
      .map(f => fs.readFileSync(path.join(filePath, f)));
    if (htmlFiles.length > 0) return parseHtmlBuffers(htmlFiles);

    throw new Error('No CSV or HTML pin files found in directory');
  }

  throw new Error(`Unsupported file type: ${ext}. Pass a .zip, .csv, or .html file.`);
}

module.exports = { parseExport };
