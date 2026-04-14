import { getTagColor } from '../utils/tagColor.js';
import { esc }         from '../utils/helpers.js';

/**
 * Builds a masonry image card DOM element (.image-card).
 *
 * @param {Object}   image
 * @param {number}   idx
 * @param {Object}   opts
 * @param {boolean}  opts.isSelected      - Whether the card starts selected
 * @param {number}   opts.cardWidth       - Current rendered card width (px)
 * @param {Array}    opts.tags            - Full tag definitions for color lookup
 * @param {Function} opts.scheduleLayout  - Trigger masonry relayout after image load
 * @param {Function} opts.onSelectZone    - (e, imageId, idx) → selection logic
 * @param {Function} opts.onOpen          - (imageId) → open detail panel
 * @param {Function} opts.onMouseDown     - (e, card) → drag initiation
 */
export function buildCard(image, idx, {
  isSelected    = false,
  cardWidth     = 220,
  tags          = [],
  scheduleLayout,
  onSelectZone,
  onOpen,
  onMouseDown,
} = {}) {
  const card = document.createElement('div');
  card.className  = 'image-card' + (isSelected ? ' selected' : '');
  card.dataset.id  = image.id;
  card.dataset.idx = idx;

  const thumb = (image.thumbnail && image.thumbnail !== 'error' && image.thumbnail !== 'placeholder')
    ? `/thumbs/${image.thumbnail}`
    : image.filename
      ? `/images/${image.filename}`
      : null;

  const tagBadges = (image.tags || []).map(name => {
    const t     = tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const style = color ? `style="background:${esc(color)}"` : '';
    return `<span class="tag-badge" ${style}>${esc(name)}</span>`;
  }).join('');

  let title = image.page_title;
  if (!title) { try { title = new URL(image.source_url).hostname; } catch { title = ''; } }

  const aspectRatio     = (image.width && image.height) ? (image.height / image.width) : 1.3;
  const placeholderHeight = Math.round(cardWidth * aspectRatio);

  card.innerHTML = `
    <div class="card-select-zone"><div class="card-checkbox"></div></div>
    <div class="card-inner">
      <div class="card-image-wrap">
        <div class="card-skeleton" style="height:${placeholderHeight}px"></div>
        ${thumb ? `<img src="${esc(thumb)}" alt="${esc(title)}" loading="lazy">` : ''}
      </div>
      <div class="card-meta">
        <div class="card-title">${esc(title)}</div>
        <div class="card-badges">${tagBadges}</div>
      </div>
    </div>
  `;

  if (thumb) {
    const img = card.querySelector('img');
    img.addEventListener('load', () => {
      card.querySelector('.card-skeleton')?.remove();
      img.classList.add('img-loaded');
      scheduleLayout?.();
    });
    img.addEventListener('error', () => {
      const sk = card.querySelector('.card-skeleton');
      if (sk) { sk.style.animation = 'none'; sk.style.background = 'var(--surface)'; }
      scheduleLayout?.();
    });
  }

  card.querySelector('.card-select-zone').addEventListener('click', e => {
    e.stopPropagation();
    onSelectZone?.(e, image.id, idx);
  });

  card.querySelector('.card-inner').addEventListener('click', e => {
    if (e.target.closest('.card-select-zone')) return;
    onOpen?.(image.id);
  });

  card.addEventListener('mousedown', e => {
    if (e.target.closest('.card-select-zone')) return;
    onMouseDown?.(e, card);
  });

  return card;
}
