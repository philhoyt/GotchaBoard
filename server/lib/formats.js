'use strict';

// Canonical MIME → extension map for all accepted image formats
const MIME_TO_EXT = {
  'image/jpeg':    '.jpg',
  'image/jpg':     '.jpg',
  'image/png':     '.png',
  'image/gif':     '.gif',
  'image/webp':    '.webp',
  'image/avif':    '.avif',
  'image/svg+xml': '.svg',
  'image/bmp':     '.bmp',
  'image/tiff':    '.tiff',
};

// Formats that Sharp can safely process for thumbnailing and EXIF rotation
const SHARP_SUPPORTED = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/avif', 'image/tiff', 'image/bmp',
]);

// Formats that should skip Sharp processing entirely (copy file as-is)
// GIF: multi-frame — Sharp would flatten to a single frame
// SVG: vector — handled separately in generateThumbnail
const SKIP_SHARP = new Set([
  'image/gif',
  'image/svg+xml',
]);

function extFromMime(mime) {
  return MIME_TO_EXT[mime] || null;
}

module.exports = { MIME_TO_EXT, SHARP_SUPPORTED, SKIP_SHARP, extFromMime };
