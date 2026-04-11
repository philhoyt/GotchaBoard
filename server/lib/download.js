const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { IMAGES_DIR } = require('../db');

const MAX_SIZE = 50 * 1024 * 1024; // 50MB
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
};

function extFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const ext = path.extname(u.pathname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.bmp'].includes(ext)) {
      return ext === '.jpeg' ? '.jpg' : ext;
    }
  } catch (_) {}
  return '.jpg';
}

async function downloadImage(sourceUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(sourceUrl);
    } catch (_) {
      return reject(new Error('Invalid URL'));
    }

    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.get(sourceUrl, { timeout: TIMEOUT_MS }, (res) => {
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirectCount >= MAX_REDIRECTS) {
          res.resume();
          return reject(new Error('Too many redirects'));
        }
        const location = res.headers['location'];
        if (!location) {
          res.resume();
          return reject(new Error('Redirect with no location header'));
        }
        res.resume();
        const nextUrl = location.startsWith('http') ? location : new URL(location, sourceUrl).href;
        return downloadImage(nextUrl, redirectCount + 1).then(resolve).catch(reject);
      }

      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const contentType = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!contentType.startsWith('image/')) {
        res.resume();
        return reject(new Error(`Not an image: ${contentType}`));
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      if (contentLength > MAX_SIZE) {
        res.resume();
        return reject(new Error('Image too large'));
      }

      const ext = MIME_TO_EXT[contentType] || extFromUrl(sourceUrl);
      const filename = uuidv4() + ext;
      const filepath = path.join(IMAGES_DIR, filename);
      const fileStream = fs.createWriteStream(filepath);

      let bytesReceived = 0;
      let didError = false;

      const cleanup = (err) => {
        if (didError) return;
        didError = true;
        fileStream.destroy();
        fs.unlink(filepath, () => {});
        reject(err);
      };

      res.on('data', (chunk) => {
        bytesReceived += chunk.length;
        if (bytesReceived > MAX_SIZE) {
          res.destroy();
          cleanup(new Error('Image too large'));
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        if (!didError) resolve({ filename, filepath, mimeType: contentType });
      });

      fileStream.on('error', cleanup);
      res.on('error', cleanup);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Download timed out'));
    });

    req.on('error', reject);
  });
}

module.exports = { downloadImage };
