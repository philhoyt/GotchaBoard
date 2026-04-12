# GotchaBoard

A self-hosted desktop app for bookmarking and organizing images. Save anything from the web via a Chrome extension, browse your collection, and tag and organize with smart collections.

---

## Install

Download the latest release for your platform from the [Releases page](../../releases).

| Platform | File |
|----------|------|
| Mac (Apple Silicon) | `GotchaBoard-x.x.x-mac-arm64.dmg` |
| Mac (Intel) | `GotchaBoard-x.x.x-mac-x64.dmg` |
| Windows | `GotchaBoard-x.x.x-win-x64.exe` |
| Linux | `GotchaBoard-x.x.x-linux-x86_64.AppImage` |

### Mac — first launch

GotchaBoard is not notarized (I'm not paying Apple $99/year for a free app). macOS will warn you on first launch:

1. Open the `.dmg` and drag **GotchaBoard** to **Applications**
2. **Right-click** (or Control-click) the app and choose **Open**
3. Click **Open** in the security dialog
4. After the first time, it opens normally

If macOS says the app is "damaged and can't be opened", run this in Terminal:

```bash
xattr -cr /Applications/GotchaBoard.app
```

If right-click → Open doesn't work, go to **System Settings → Privacy & Security** and click **Open Anyway**.

### Windows — first launch

Windows SmartScreen may show a "Windows protected your PC" warning:

1. Click **More info**
2. Click **Run anyway**

### Linux

```bash
chmod +x GotchaBoard-*.AppImage
./GotchaBoard-*.AppImage
```

### Where is my data stored?

All images, thumbnails, and the database are stored locally:

- **Mac:** `~/Library/Application Support/GotchaBoard/storage/`
- **Windows:** `%APPDATA%/GotchaBoard/storage/`
- **Linux:** `~/.config/GotchaBoard/storage/`

Nothing is sent to any server. Uninstalling the app does not delete your data.

---

## What it is

- **Desktop app** (Electron) — runs locally, no cloud, your images stay on your machine
- **Chrome extension** — right-click any image on any page to save it instantly
- **Tags & Collections** — organize with freeform tags; collections filter by AND logic across tags
- **Discover feed** — pulls from RSS feeds and crawls linked pages
- **Pinterest import** — bulk import from a Pinterest data export

---

## Requirements (for development)

- Node.js v22+
- npm
- Chrome (for the extension)

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

Builds the frontend and launches the app. The window opens automatically.

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
npm run dist        # current platform
npm run dist:mac    # macOS (dmg + zip, x64 + arm64)
npm run dist:win    # Windows (installer + portable)
npm run dist:linux  # Linux (AppImage + deb)
```

Outputs to `dist/` with predictable names like `GotchaBoard-1.0.0-mac-arm64.dmg`.

### Cutting a release

```bash
npm version 1.0.0   # bumps package.json, commits, and creates a v1.0.0 tag
git push && git push --tags
```

Pushing the tag triggers the GitHub Actions workflow, which builds all three platforms and creates a draft GitHub Release. Review the artifacts and click **Publish** when ready.

---

## Switching between Electron and browser mode

The native SQLite module (`better-sqlite3`) must be compiled for whichever runtime is loading it:

| Command | Compiles for |
|---|---|
| `npm start` | Electron (via `postinstall`) |
| `npm run dist` | Electron (electron-builder handles rebuild) |
| `npm run start:server` | System Node (`npm rebuild`) |
| `npm run dev` | System Node (`npm rebuild`) |

`npm install` automatically runs `electron-builder install-app-deps` (via `postinstall`), which compiles native modules for Electron. The server-mode scripts call `npm rebuild` to recompile for system Node when needed.

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
