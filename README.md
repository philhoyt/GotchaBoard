# GotchaBoard

A self-hosted desktop app for bookmarking and organizing images. Save anything from the web via a Chrome extension, browse your collection, tag and organize with smart collections, and discover new images matched to your taste using AI.

---

## What it is

- **Desktop app** (Electron) — runs locally, no cloud, your images stay on your machine
- **Chrome extension** — right-click any image on any page to save it instantly
- **Discover feed** — pulls from RSS feeds and crawls linked pages, scores candidates against your taste profile using Claude Vision
- **Tags & Smart Collections** — organize with freeform tags; smart collections auto-update based on tag rules
- **Pinterest import** — bulk import from a Pinterest data export

---

## Requirements

- Node.js v22+
- npm
- Chrome (for the extension)
- An Anthropic API key (for Discover / taste scoring)

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
ANTHROPIC_API_KEY=your_key_here

# Discover tuning (optional — these are the defaults)
DISCOVER_SCORE_THRESHOLD=6
DISCOVER_SAMPLE_SIZE=20
LINK_HOP_DEPTH=1
LINK_HOP_EXTERNAL=false
```

### 3. Install the Chrome extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. The "Save to Gotcha" extension will appear in your toolbar

> The extension sends images to `http://localhost:3000`. When running as the desktop app the server picks a random port — open the extension popup and update the server URL to match (shown on app startup in the terminal).

---

## Running

### Desktop app (Electron)

```bash
npm start
```

This rebuilds native modules for Electron then launches the app. On first run this takes ~15 seconds. The window opens automatically.

### Browser only (for CSS/JS development)

```bash
npm run start:server
```

Then open `http://localhost:3000` in Chrome. Faster iteration — no Electron rebuild needed.

### Watch mode (auto-restart on server changes)

```bash
npm run dev
```

---

## Building a distributable

```bash
npm run dist
```

Outputs to `dist/`:
- `GotchaBoard-1.0.0-arm64.dmg` — drag-to-Applications installer
- `GotchaBoard-1.0.0-arm64-mac.zip` — raw `.app` bundle

### Opening unsigned builds on macOS

Since the app isn't signed with an Apple Developer certificate, macOS will block it. After building, run:

```bash
xattr -cr dist/mac-arm64/GotchaBoard.app
```

Then double-click the `.app` to open it. Re-run this command after each new build.

If you install to `/Applications`, run:
```bash
xattr -cr /Applications/GotchaBoard.app
```

---

## Switching between Electron and browser mode

The native SQLite module (`better-sqlite3`) must be compiled for whichever runtime is loading it. The npm scripts handle this automatically:

| Command | Compiles for |
|---|---|
| `npm start` | Electron |
| `npm run dist` | Electron |
| `npm run start:server` | System Node |
| `npm run dev` | System Node |

Each command rebuilds the native module before running, so you can switch freely without manual steps.

---

## Importing from Pinterest

Export your Pinterest data from your account settings (Settings → Privacy and data → Request your data). Once you have the zip:

```bash
npm run import:pinterest
```

Follow the prompts to point it at your export file.

---

## Discover

The Discover tab surfaces images that match your visual taste.

### How it works

1. **Add sources** — add RSS feeds or URLs to crawl in the Discover settings panel
2. **Generate a taste profile** — GotchaBoard analyzes your saved images and generates a text description of your aesthetic using Claude Vision
3. **Scoring** — crawled/linked images are scored 1–10 against your taste profile; images above the threshold appear in the feed
4. **RSS sources are trusted** — images from RSS feeds you add are shown automatically without scoring (you chose those sources)

### Scoring threshold

Set `DISCOVER_SCORE_THRESHOLD` in `.env` (default: `6`). Higher = stricter matching.

### Running a discovery cycle manually

Hit the **Run** button in the Discover panel, or `POST /api/discover/run`.

---

## Project structure

```
electron/         Electron main process and preload
extension/        Chrome extension ("Save to Gotcha")
public/           Frontend (HTML, CSS, JS) — served by Express
  css/            Design system (tokens, typography, components)
  js/             Shared utilities (theme, tag colors, animations)
server/
  routes/         Express route handlers
  lib/            Crawler, scorer, downloader, thumbnail generator
  jobs/           Scheduled cron jobs (discover cycle)
  db.js           SQLite setup and migrations
  index.js        Express app entry point
import/           Pinterest import script
storage/          Runtime data (gitignored)
  images/         Saved full-size images
  thumbs/         Thumbnails
  gotchaboard.db  SQLite database
build/            App icons for packaging (icon.icns, icon.ico)
dist/             Built Electron app output (gitignored)
```

---

## Data & storage

All data is stored locally:

- **Database**: `storage/gotchaboard.db` (SQLite)
- **Images**: `storage/images/`
- **Thumbnails**: `storage/thumbs/`

When running as the packaged desktop app, storage lives in:
- macOS: `~/Library/Application Support/GotchaBoard/storage/`
- Windows: `%APPDATA%/GotchaBoard/storage/`

When running in dev mode (`npm start` or `npm run start:server`), storage is in the project root `storage/` folder.

---

## Regenerating app icons

The icons in `build/` were generated from `public/icon.png`. To regenerate after changing the icon:

```bash
# macOS .icns
mkdir -p build/icon.iconset
for size in 16 32 128 256 512; do
  sips -z $size $size public/icon.png --out build/icon.iconset/icon_${size}x${size}.png
  sips -z $((size*2)) $((size*2)) public/icon.png --out build/icon.iconset/icon_${size}x${size}@2x.png
done
iconutil -c icns build/icon.iconset -o build/icon.icns
```

The `.ico` for Windows is generated by a small Node script using `sharp` — see the build setup notes if needed.
