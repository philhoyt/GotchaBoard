'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');
const { IMAGES_DIR } = require('../db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── scoreCandidate ─────────────────────────────────────────────────
// Scores a single candidate image URL against the taste profile.
// Returns { score: number (0-10), reason: string }
async function scoreCandidate(imageUrl, profileText) {
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'url', url: imageUrl },
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
