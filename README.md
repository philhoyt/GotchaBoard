# GotchaBoard

Self-hosted image bookmarking — save, tag, and discover. Runs entirely on your machine.

## What is it?

GotchaBoard is a desktop app for saving and organizing images from the web. Right-click any image in Chrome to save it. Tag it, put it in a collection, drag it onto labels. A Discover tab crawls RSS feeds and queues images for you to save or dismiss.

No cloud. No subscriptions. Your images live in a SQLite database on your own machine.

## Features

- Chrome extension — click the toolbar icon to browse and multi-select images on the page, or right-click any image for a quick single save.
- Collections — freeform tags; collections use AND/OR logic across multiple tags.
- Drag and drop — select multiple cards, drag the stack onto a tag in the sidebar.
- Discover feed — crawls RSS feeds and linked pages, queues images for you to save or dismiss.
- Pinterest import — bulk import from a Pinterest data export ZIP, in-app.
- Masonry grid — adaptive layout with XL to XXS scale options.
- Fully local — SQLite database, all images stored on your machine.
- Cross-platform — macOS, Windows, Linux via Electron.

## Install

Download the latest release for your platform from the [Releases page](../../releases).

| Platform | File |
|----------|------|
| Mac (Apple Silicon) | `GotchaBoard-x.x.x-mac-arm64.dmg` |
| Mac (Intel) | `GotchaBoard-x.x.x-mac-x64.dmg` |
| Windows | `GotchaBoard-x.x.x-win-x64.exe` |
| Linux | `GotchaBoard-x.x.x-linux-x86_64.AppImage` |

### macOS — first launch

GotchaBoard is signed and notarized. Open the `.dmg`, drag **GotchaBoard** to **Applications**, and launch normally.

### Windows — first launch

Windows SmartScreen may show a "Windows protected your PC" warning. Click **More info** then **Run anyway**.

### Linux

```bash
chmod +x GotchaBoard-*.AppImage
./GotchaBoard-*.AppImage
```

## Chrome Extension

Install **Save to Gotcha** from the [Chrome Web Store](https://chrome.google.com/webstore/detail/mbbheknbgginndgjnagcjdjbdpinmghd) — one click, no developer mode needed.

**Toolbar icon** — click the extension icon to scan the page for images, select one or more, add shared tags, and save them all at once.

**Right-click** any image → **Save to Gotcha** → add tags → done.

The extension connects to your local GotchaBoard server at `http://localhost:47315` by default. If you need to change the port, click the ⚙ icon in the extension popup and update the server URL.

### Manual install (developer mode)

If you prefer not to use the Web Store:

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top right.
3. Click **Load unpacked** and select the `extension/` folder from this repo.
4. The **Save to Gotcha** extension appears in your toolbar.

## Discover

The Discover tab crawls RSS feeds and linked pages to surface new images.

1. **Add sources** — paste RSS feed URLs or page URLs in the Discover settings panel.
2. **Run a cycle** — hit the **Run** button (or `POST /api/discover/run`) to crawl and queue new images.
3. **Browse** — images from your sources appear in the Discover feed; save or dismiss each one.

Images auto-dismiss after 8 views.

## Importing from Pinterest

In the app: **Settings > Import Pinterest**. Drop your Pinterest data export ZIP into the dialog.

To get your export: Pinterest > **Settings > Privacy and data > Request your data**. Pinterest emails you a download link, usually within a few hours.

## Data Storage

All data is local:

| Location | Dev mode | Packaged app |
|---|---|---|
| Database | `storage/gotchaboard.db` | `~/Library/Application Support/GotchaBoard/storage/` (Mac) |
| Images | `storage/images/` | `%APPDATA%/GotchaBoard/storage/` (Windows) |
| Thumbnails | `storage/thumbs/` | `~/.config/GotchaBoard/storage/` (Linux) |

Uninstalling the app does not delete your data.

## Building from Source

### Prerequisites

- Node.js v22+
- npm
- Chrome (for the extension)

### Run locally

```bash
git clone https://github.com/philhoyt/GotchaBoard.git
cd GotchaBoard
npm install
npm start                   # builds frontend and launches Electron
```

### Browser-only mode

Faster for CSS and JS iteration — runs Express only, no Electron:

```bash
npm run start:server
```

Then open `http://localhost:3000` in Chrome.

### Watch mode

```bash
npm run dev
```

Auto-restarts on server changes.

### Build distributables

```bash
npm run dist        # current platform
npm run dist:mac    # macOS (dmg + zip, x64 + arm64)
npm run dist:win    # Windows (installer + portable)
npm run dist:linux  # Linux (AppImage + deb)
```

Output goes to `dist/` as `GotchaBoard-{version}-{os}-{arch}.{ext}`.

### Cutting a release

```bash
npm version 1.x.x           # bumps package.json, commits, tags
git push && git push --tags
```

Pushing the tag triggers GitHub Actions, which builds all platforms and creates a draft release. Review the artifacts and publish when ready.

## SQLite Native Module

`better-sqlite3` is a native module that must be compiled for the runtime loading it:

| Command | Compiles for |
|---|---|
| `npm install` / `npm start` | Electron (via `postinstall`) |
| `npm run dist` | Electron (electron-builder handles it) |
| `npm run start:server` | System Node (`npm rebuild`) |
| `npm run dev` | System Node (`npm rebuild`) |

If you switch between `npm start` and `npm run start:server`, run `npm rebuild` before switching back to server mode, or `npm install` to restore Electron-compiled binaries.

## Project Structure

```
electron/         Electron main process and preload script
extension/        Chrome extension ("Save to Gotcha")
src/              Frontend source
  index.html      Main app
  discover.html   Discover tab
  tags.html       Tag manager
  js/             App logic, components, utilities
  styles/         SCSS design system (tokens, typography, components)
  public/         Static assets copied to build output (icon, etc.)
server/
  routes/         Express API route handlers
  lib/            Crawler, downloader, thumbnail generator, scorer
  jobs/           Scheduled jobs (discover cycle)
  db.js           SQLite setup and schema migrations
  index.js        Express entry point
import/           Pinterest import script (CLI fallback)
build/            App icons for packaging (.icns, .ico, iconset)
public/           Built frontend output — generated by `npm run build` (gitignored)
storage/          Runtime data — gitignored
  images/         Saved full-size images
  thumbs/         Thumbnails
  gotchaboard.db  SQLite database
```

## Regenerating App Icons

Icons in `build/` are generated from `src/public/icon.png`. To regenerate:

```bash
ICONSET=build/icon.iconset
for size in 16 32 128 256 512; do
  sips -z $size $size src/public/icon.png --out $ICONSET/icon_${size}x${size}.png
  sips -z $((size*2)) $((size*2)) src/public/icon.png --out $ICONSET/icon_${size}x${size}@2x.png
done

iconutil -c icns build/icon.iconset -o build/icon.icns

sips -z 256 256 src/public/icon.png --out /tmp/icon_256.png
sips /tmp/icon_256.png -s format ico --out build/icon.ico
```

## License

MIT. See [LICENSE](LICENSE).