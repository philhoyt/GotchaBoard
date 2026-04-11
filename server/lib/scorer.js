'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const https = require('https');
const http  = require('http');
const path = require('path');
const fs = require('fs');
const { IMAGES_DIR } = require('../db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── fetchImageAsBase64 ────────────────────────────────────────────
// Downloads an image URL and returns { data: base64string, mediaType }
function fetchImageAsBase64(rawUrl, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(rawUrl); } catch (e) { return reject(e); }

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(rawUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GotchaBoard/1.0)',
        'Accept': 'image/*',
      },
      timeout,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImageAsBase64(res.headers.location, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

      const contentType = res.headers['content-type'] || 'image/jpeg';
      const mediaType = contentType.split(';')[0].trim();
      // Only accept image types Claude supports
      const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!supported.includes(mediaType)) return reject(new Error(`Unsupported media type: ${mediaType}`));

      const MAX_BYTES = 4 * 1024 * 1024; // 4MB hard cap (Claude limit is 5MB)
      let total = 0;
      const chunks = [];
      res.on('data', c => {
        total += c.length;
        if (total > MAX_BYTES) {
          req.destroy();
          return reject(new Error('Image too large'));
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({
        data: Buffer.concat(chunks).toString('base64'),
        mediaType,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── scoreCandidate ─────────────────────────────────────────────────
// Scores a single candidate image URL against the taste profile.
// Returns { score: number (0-10), reason: string }
async function scoreCandidate(imageUrl, profileText) {
  // Fetch the image ourselves so CDN restrictions don't block Claude
  const { data, mediaType } = await fetchImageAsBase64(imageUrl);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data },
        },
        {
          type: 'text',
          text: `You are scoring an image for relevance to a user's visual taste profile.

Taste profile:
${profileText}

Score this image from 0 to 10 based on how well it matches the taste profile.
- 0–3: Does not match at all
- 4–5: Weak match
- 6–7: Good match
- 8–10: Excellent match

Respond with ONLY this JSON (no markdown, no explanation):
{"score": <number>, "reason": "<one sentence>"}`,
        },
      ],
    }],
  });

  const raw = response.content[0].text.trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      score:  Math.max(0, Math.min(10, Number(parsed.score))),
      reason: String(parsed.reason || ''),
    };
  } catch (_) {
    // Try to extract score from malformed response
    const match = raw.match(/(\d+(?:\.\d+)?)/);
    return { score: match ? parseFloat(match[1]) : 5, reason: raw.slice(0, 200) };
  }
}

// ── generateTasteProfile ──────────────────────────────────────────
// Analyzes a sample of saved images and produces a taste profile +
// a list of search queries for taste-driven discovery.
// images: array of { id, filename } from the images table
async function generateTasteProfile(images) {
  // Build image content blocks — use local files for accuracy
  const imageBlocks = [];
  for (const img of images.slice(0, 20)) { // Claude supports up to 20 images per message
    const filepath = path.join(IMAGES_DIR, img.filename);
    if (!fs.existsSync(filepath)) continue;

    try {
      const data = fs.readFileSync(filepath);
      const ext  = path.extname(img.filename).toLowerCase();
      const mediaType = ext === '.png' ? 'image/png'
        : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
        : 'image/jpeg';

      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: data.toString('base64'),
        },
      });
    } catch (_) {
      // Skip unreadable files
    }
  }

  if (imageBlocks.length === 0) {
    throw new Error('No readable images found in sample');
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        ...imageBlocks,
        {
          type: 'text',
          text: `Analyze these ${imageBlocks.length} images from a user's saved collection and produce:

1. A taste profile paragraph (3–5 sentences) describing their visual aesthetic — note patterns in composition, color palette, subject matter, mood, style, and any recurring themes.

2. A list of ${parseInt(process.env.TASTE_SEARCH_QUERIES_PER_CYCLE || '10')} specific image search queries that would surface more images matching this aesthetic. Each query should be specific and varied — avoid generic terms.

Respond with ONLY this JSON (no markdown):
{
  "profile_text": "<paragraph>",
  "search_queries": ["<query1>", "<query2>", ...]
}`,
        },
      ],
    }],
  });

  const raw = response.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    // Attempt to extract JSON from response
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Failed to parse taste profile response');
  }
}

module.exports = { scoreCandidate, generateTasteProfile };
