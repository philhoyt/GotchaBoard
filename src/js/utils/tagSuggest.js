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
  let activeIndex = -1;

  const applyPosition = () => {
    if (!cachedRect) return;
    el.style.top   = `${cachedRect.bottom + 2}px`;
    el.style.left  = `${cachedRect.left}px`;
    el.style.width = `${Math.max(cachedRect.width, 180)}px`;
  };

  const setActive = (index) => {
    const items = el.querySelectorAll('.mt-suggestion');
    items.forEach((item, i) => item.classList.toggle('active', i === index));
    activeIndex = index;
    if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
  };

  const show = (val) => {
    el.innerHTML = '';
    activeIndex = -1;
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

  const hide = () => { el.hidden = true; activeIndex = -1; };

  // Read rect while layout is guaranteed clean — before any input-driven DOM writes
  input.addEventListener('focus', () => {
    cachedRect = input.getBoundingClientRect();
    applyPosition();
  });

  input.addEventListener('input', () => show(input.value));
  input.addEventListener('blur',  () => setTimeout(hide, 150));

  input.addEventListener('keydown', e => {
    const items = el.querySelectorAll('.mt-suggestion');
    const count = items.length;
    const visible = !el.hidden && count > 0;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visible) setActive(activeIndex < count - 1 ? activeIndex + 1 : 0);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (visible) setActive(activeIndex > 0 ? activeIndex - 1 : count - 1);
      return;
    }

    if (e.key === 'Enter') {
      if (visible && activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        e.stopPropagation();
        onSelect(items[activeIndex].textContent);
        input.value = '';
        hide();
        return;
      }
      // No suggestion highlighted — fall through to the caller's Enter handler
      hide();
      return;
    }

    if (e.key === 'Tab' && visible && activeIndex >= 0 && items[activeIndex]) {
      e.preventDefault();
      onSelect(items[activeIndex].textContent);
      input.value = '';
      hide();
      return;
    }

    if (e.key === 'Escape') {
      if (visible) {
        e.stopPropagation(); // Don't close the detail panel / modal on first Escape
        hide();
      }
      return;
    }
  });

  return {
    destroy() { el.remove(); },
  };
}
