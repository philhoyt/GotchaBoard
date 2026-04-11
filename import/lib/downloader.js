// Thin wrapper around the server's download + thumbnail libs.
// Paths work correctly because Node resolves each file's own requires
// relative to that file's location, not the caller's location.

const { downloadImage }                         = require('../../server/lib/download');
const { generateThumbnail, thumbFilenameFor }   = require('../../server/lib/thumbnail');

async function downloadPin(imageUrl) {
  const { filename, filepath } = await downloadImage(imageUrl);
  const thumbFilename = thumbFilenameFor(filename);
  const thumbnail = await generateThumbnail(filepath, thumbFilename);
  return { filename, thumbnail };
}

module.exports = { downloadPin };
