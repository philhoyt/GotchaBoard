const sharp = require('sharp');
const path = require('path');
const { THUMBS_DIR } = require('../db');

async function generateThumbnail(sourcePath, thumbFilename) {
  // SVG requires librsvg which may not be available — use placeholder
  if (sourcePath.toLowerCase().endsWith('.svg')) {
    return 'placeholder';
  }

  const thumbPath = path.join(THUMBS_DIR, thumbFilename);

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
