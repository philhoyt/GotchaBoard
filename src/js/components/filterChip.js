import { esc } from '../utils/helpers.js';

/**
 * Creates a dismissible filter chip DOM element (.filter-chip).
 * Used by sidebar renderActiveFilters.
 *
 * @param {string}   label    - Display label
 * @param {Function} onRemove - Click handler for the × button
 */
export function buildFilterChip(label, onRemove) {
  const chip = document.createElement('span');
  chip.className = 'filter-chip';
  chip.innerHTML = `${esc(label)} <button>&times;</button>`;
  chip.querySelector('button').addEventListener('click', onRemove);
  return chip;
}
