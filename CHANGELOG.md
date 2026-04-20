# Changelog

All notable changes to GotchaBoard are documented here.

## [Unreleased]

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
