'use strict';

export const TAG_PALETTE = [
  '#FFB880', // peach
  '#7FEDC8', // mint
  '#C4AAFF', // lavender
  '#80CCFF', // sky
  '#FFE566', // lemon
  '#FF8080', // coral
];

export function getTagColor(tagName) {
  let hash = 0;
  const s = (tagName || '').toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
}
