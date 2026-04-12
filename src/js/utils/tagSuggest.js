'use strict';

import { getTagColor } from './tagColor.js';

/**
 * Attaches a floating autocomplete dropdown to a tag text input.
 * The dropdown is appended to <body> and positioned with fixed coords so it
 * works inside any flex/scroll container without disrupting layout.
 *
 * Input rect is read on focus (when layout is clean) and cached for the
 * duration of that focus session, avoiding forced-reflow reads after DOM
 * writes in show().
 *
 * @param {HTMLInputElement} input
 * @param {Function} getTagDefs  Returns [{name, color}]
 * @param {Function} onSelect    Called with tag name when a suggestion is picked
 * @returns {{ destroy: Function }}
 */
export function attachTagSuggestions(input, getTagDefs, onSelect) {
  const el = document.createElement('div');
  el.className = 'tag-suggest-dropdown';
  el.hidden = true;
  document.body.appendChild(el);

  // Cached rect — read once on focus (layout is clean), reused on every
  // keystroke so we never call getBoundingClientRect() after a DOM write.
  let cachedRect = null;

  const applyPosition = () => {
    if (!cachedRect) return;
    el.style.top   = `${cachedRect.bottom + 2}px`;
    el.style.left  = `${cachedRect.left}px`;
    el.style.width = `${Math.max(cachedRect.width, 180)}px`;
  };

  const show = (val) => {
    el.innerHTML = '';
    if (!val.trim()) { el.hidden = true; return; }
    const defs    = getTagDefs();
    const lower   = val.toLowerCase();
    const matches = defs.filter(t => t.name.toLowerCase().includes(lower)).slice(0, 8);
    if (matches.length === 0) { el.hidden = true; return; }
    // DOM writes only — no layout read here
    for (const t of matches) {
      const item = document.createElement('div');
      item.className = 'mt-suggestion';
      item.textContent = t.name;
      item.style.setProperty('--sug-dot', t.color || getTagColor(t.name));
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        onSelect(t.name);
        input.value = '';
        el.hidden = true;
      });
      el.appendChild(item);
    }
    applyPosition();
    el.hidden = false;
  };

  const hide = () => { el.hidden = true; };

  // Read rect while layout is guaranteed clean — before any input-driven DOM writes
  input.addEventListener('focus', () => {
    cachedRect = input.getBoundingClientRect();
    applyPosition();
  });

  input.addEventListener('input',   () => show(input.value));
  input.addEventListener('blur',    () => setTimeout(hide, 150));
  input.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter') hide(); });

  return {
    destroy() { el.remove(); },
  };
}
