import { esc } from '../utils/helpers.js';

/**
 * Creates a removable tag pill DOM element (.detail-tag-pill).
 * Used by detailPanel, bulkActions, and addGotModal.
 *
 * @param {string}        name      - Tag name
 * @param {string|null}   color     - Background color (inline pastel)
 * @param {Function|null} onRemove  - Click handler for the × button
 */
export function createTagPill(name, color, onRemove = null) {
  const pill = document.createElement('span');
  pill.className   = 'detail-tag-pill';
  pill.dataset.tag = name;
  if (color) pill.style.background = color;
  pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove tag">&times;</button>`;
  if (onRemove) pill.querySelector('.detail-tag-remove').addEventListener('click', onRemove);
  return pill;
}
