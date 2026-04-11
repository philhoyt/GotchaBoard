'use strict';

// Deterministic tag color — same tag name always gets the same pastel.
// Custom colors stored in tags.color take precedence; use this as the fallback.
const TAG_PALETTE = [
  '#FFB880', // peach
  '#7FEDC8', // mint
  '#C4AAFF', // lavender
  '#80CCFF', // sky
  '#FFE566', // lemon
  '#FF8080', // coral
];

window.getTagColor = function getTagColor(tagName) {
  let hash = 0;
  const s = (tagName || '').toLowerCase();
  for (let i = 0; i < s.length; i++) {
    hash = s.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length];
};
