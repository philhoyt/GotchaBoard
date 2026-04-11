# Pinterest Import Tool

Imports your Pinterest export into GotchaBoard. Parses the exported CSV, visits each pin page with a headless browser to find the full-resolution image URL, downloads it, and adds it to your library. Pinterest board names become tags.

---

## Before you start

1. **Request your Pinterest data.** Go to Pinterest → Settings → Privacy and data → Request your data. Pinterest emails you a download link within 24 hours.

2. **Download the ZIP.** The email contains a link to a `.zip` file. Save it anywhere — your Downloads folder is fine.

3. **Make sure GotchaBoard's server is running.** The importer writes directly to the database, so the server doesn't need to be running. But confirm you're in the project directory and dependencies are installed:
   ```
   npm install
   ```

---

## Basic usage

```bash
node import/pinterest.js --file ~/Downloads/pinterest-export.zip
```

Or via npm:

```bash
npm run import:pinterest -- --file ~/Downloads/pinterest-export.zip
```

The importer will:
1. Unzip and parse your export
2. Create a tag for each Pinterest board
3. Visit each pin page in a headless browser to extract the image URL
4. Download the full-resolution image and generate a thumbnail
5. Save everything to your GotchaBoard library

Progress is printed as it runs:

```
[gotcha-import] Pinterest Import Tool
=====================================

Parsing export: /Users/you/Downloads/pinterest-export.zip
Found 1,243 pins across 14 tags
Creating tags and building queue...
Tags created: 14 | Pins queued: 1,243 | Already done: 0

Processing 1,243 pins
  Concurrency : 3 parallel pages
  Delay       : 1000ms between requests

[gotcha-import] [████████████░░░░░░░░] 743/1243 | Failed: 12

[gotcha-import] Done
─────────────────────
  Imported : 1,231
  Skipped  : 0 (duplicates)
  Failed   : 12

Failed pins logged to: /path/to/gotcha/import-review.log
Re-run with --resume to retry failed pins.
```

---

## Options

| Flag | Default | Description |
|---|---|---|
| `--file <path>` | required | Path to your Pinterest ZIP or CSV file |
| `--concurrency <n>` | `3` | Number of pin pages to process in parallel |
| `--delay <ms>` | `1000` | Milliseconds to wait between requests on each browser tab |
| `--dry-run` | off | Parse and queue pins only — no downloads, no browser |
| `--resume` | off | Skip pins already marked done; retry previously failed pins |

---

## What gets imported

Each imported image is saved with:
- The full-resolution image file and a thumbnail
- The pin's title (from your export CSV) as the page title
- The Pinterest pin URL as the page URL
- A tag matching the Pinterest board name (lowercased)

Images that were already in GotchaBoard (matched by image URL) are skipped and counted as duplicates.

---

## Boards become tags

Pinterest board names are mapped to GotchaBoard tags. If a tag with that name already exists, the imported pins are added to it. No duplicate tags are created.

Board names are stored lowercase. "Travel Photography" becomes the tag `travel photography`.

---

## If the run gets interrupted

Use `--resume` to pick up where you left off. It skips pins already marked done and retries any that previously failed:

```bash
node import/pinterest.js --file ~/Downloads/pinterest-export.zip --resume
```

---

## Failed pins

Pins that couldn't be imported are written to `import-review.log` in the project root:

```
[FAILED] https://pinterest.com/pin/123456 | reason: 404 | board: Typography | title: "Helvetica poster"
[FAILED] https://pinterest.com/pin/789012 | reason: timeout | board: Architecture | title: ""
```

Common reasons:
- `404` — the pin has been deleted
- `timeout` — Pinterest didn't load the page in time
- `no image found` — the page loaded but no image could be extracted
- `download failed: ...` — the image URL was found but the file couldn't be downloaded

You can visit any failed pin URL manually and save it via the browser extension.

---

## Tuning speed vs. reliability

The defaults (3 concurrent pages, 1 second delay) are conservative. Pinterest occasionally rate-limits aggressive scrapers. If you're seeing a lot of timeouts or failures, slow it down:

```bash
node import/pinterest.js --file ~/Downloads/export.zip --concurrency 1 --delay 2000
```

If your export is small and you want it done faster, you can push the concurrency up:

```bash
node import/pinterest.js --file ~/Downloads/export.zip --concurrency 5 --delay 500
```

Concurrency is capped at 10.

---

## Dry run

To see what would be imported without downloading anything:

```bash
node import/pinterest.js --file ~/Downloads/export.zip --dry-run
```

This parses the CSV, creates tags, and queues pins — but stops before launching the browser. Useful for checking pin and board counts before committing to a long run.

---

## Accepted file formats

- Pinterest ZIP export (as downloaded from Pinterest)
- A single `pins.csv` file if you've already unzipped it
- A directory containing a `pins.csv` (if you unzipped manually)
