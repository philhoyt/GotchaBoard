# Changelog

All notable changes to GotchaBoard are documented here.

## [1.1.3] - 2026-04-21

### Added
- Detail panel now has an "Open File" button (Electron only) that opens the locally saved image in the system's default viewer.

### Fixed
- "Open Source" button now opens the page the image was saved from (`page_url`) rather than the raw image URL, and is hidden when no navigable URL exists (e.g. images saved via drag-and-drop).
- Source URL field in the detail panel is hidden for images with no real source URL (previously showed `local://upload`).
- `npm start` now always recompiles `better-sqlite3` for Electron before launching, preventing the NODE_MODULE_VERSION mismatch after running `npm run dev`.

## [1.1.2] - 2026-04-21

### Fixed
- Chrome extension now saves images from hotlink-protected sites (e.g. siteinspire.com). Images are fetched via the extension's background service worker, which bypasses CORS and sends the browser's existing cookies for the source site. Previously these saves failed with HTTP 403 or a CORS error.
- Multi-select save now shows the actual error message on failure instead of the generic "Is the server running?" message.

## [1.1.1] - 2026-04-20

### Added
- Settings panel now shows the current app version and a "Release notes" link to the GitHub releases page.
- Grid auto-refreshes when you return to the app after saving via the Chrome extension. If you're filtered or scrolled down, a mint banner appears instead so you don't lose your place.

### Changed
- GitHub release notes now pull directly from CHANGELOG.md instead of the auto-generated commit list.

## [1.1.0] - 2026-04-20

### Added
- Block source in Discover — open any card's save panel and click "⊘ Block this source" to dismiss all candidates from that domain and prevent future crawls from re-adding them. If the domain came from a user-added RSS/scrape source, that source is also removed.
- Discover cycle now shows the progress UI automatically when the daily cron job fires, not just when triggered manually.

### Fixed
- Hardened JSON.parse calls in the image upload and smart collection filter routes — malformed input now returns a 400 instead of crashing the request.
- RSS crawler now blocks requests to private/loopback IP addresses, preventing SSRF via user-added sources.
- RSS scraper frequency reduced from hourly to daily (3 AM) to reduce background network usage.

### Changed
- Mac releases now ship DMG only — ZIP removed

## [1.0.2] - 2026-04-20

### Added
- In-app update notification banner — a dismissible banner appears at the bottom of the screen when a newer version is available on GitHub. Dismissal is remembered per-version.

### Fixed
- Load more now triggers correctly after switching to a smaller card size via the grid scale buttons

## [1.0.1] - 2026-04-20

### Fixed
- On small viewports (xxs/xs), the initial pin load now auto-fills the viewport — previously the scroll trigger could never fire if the grid didn't overflow the screen
- Resizing the browser window to a smaller size now also triggers a fill check

## [1.0.0] - 2026-04-13

### Added
- Local image board with masonry grid layout and fluid card sizing
- Save images via URL paste, file upload, or drag-and-drop onto the board
- Chrome extension for one-click saving from any page
- Tag system with autocomplete, bulk tagging, and filter chips
- Smart Collections with OR-based tag rules
- Discover engine for browsing and importing images from RSS feeds and Pinterest exports
- Detail panel with editable title, tag management, and image metadata
- Bulk select, tag, and delete with multi-select and shift-click range
- Sort by date saved, title, and more
- Light and dark mode with system preference detection
- macOS signed and notarized builds; Windows and Linux installers
