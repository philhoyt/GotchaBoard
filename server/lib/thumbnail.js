const sharp = require('sharp');
const path = require('path');
const { THUMBS_DIR } = require('../db');

async function generateThumbnail(sourcePath, thumbFilename) {
  const thumbPath = path.join(THUMBS_DIR, thumbFilename);
  const isSvg = sourcePath.toLowerCase().endsWith('.svg');

  if (isSvg) {
    // Attempt to rasterize SVG via Sharp (requires librsvg — bundled in Sharp ≥0.30).
    // Density hint ensures small SVGs render at reasonable resolution.
    // Output as PNG to preserve transparency.
    const pngThumbFilename = thumbFilename.replace(/\.jpg$/, '.png');
    const pngThumbPath = path.join(THUMBS_DIR, pngThumbFilename);
    try {
      await sharp(sourcePath, { density: 150 })
        .resize({ width: 400, withoutEnlargement: true })
        .png()
        .toFile(pngThumbPath);
      return pngThumbFilename;
    } catch (err) {
      console.error('SVG thumbnail generation failed (will use original):', err.message);
      return 'placeholder';
    }
  }

  try {
    await sharp(sourcePath)
      .rotate()                                        // apply EXIF orientation, then strip tag
      .resize({ width: 400, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);
    return thumbFilename;
  } catch (err) {
    console.error('Thumbnail generation failed:', err.message);
    return 'error';
  }
}

// Given a source filename (e.g. "abc123.png"), return the thumb filename (e.g. "abc123.jpg")
function thumbFilenameFor(sourceFilename) {
  const base = path.basename(sourceFilename, path.extname(sourceFilename));
  return base + '.jpg';
}

module.exports = { generateThumbnail, thumbFilenameFor };
