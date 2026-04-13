'use strict';

import { getTagColor } from './utils/tagColor.js';

export class BulkActionBar {
  constructor({ selection, onAction, getTags, getTagDefs }) {
    this.selection  = selection;
    this.onAction   = onAction;
    this.getTags    = getTags    || (() => []);
    this.getTagDefs = getTagDefs || (() => []);
    this._el        = null;
    this._visible   = false;

    this._build();
    selection.addEventListener('change', () => this._sync());
  }

  _build() {
    this._el = document.createElement('div');
    this._el.id = 'bulk-bar';
    this._el.setAttribute('aria-live', 'polite');
    this._el.innerHTML = `
      <span id="bulk-count"></span>
      <div id="bulk-actions">
        <button class="bulk-btn" data-action="manage_tags">Manage Tags</button>
        <button class="bulk-btn" data-action="move_to_tags">Move to Tag</button>
        <button class="bulk-btn bulk-btn-danger" data-action="delete">Delete</button>
      </div>
      <button id="bulk-deselect" title="Deselect all">✕ Deselect</button>
    `;
    document.body.appendChild(this._el);

    this._el.querySelectorAll('.bulk-btn').forEach(btn => {
      btn.addEventListener('click', () => this._handleAction(btn.dataset.action));
    });

    this._el.querySelector('#bulk-deselect').addEventListener('click', () => {
      this.selection.clear();
    });
  }

  _sync() {
    const n = this.selection.size;

    if (n > 0 && !this._visible) {
      this._el.style.display = 'flex';
      this._el.animate([
        { transform: 'translateY(100%) translateX(-50%)', opacity: 0 },
        { transform: 'translateY(0) translateX(-50%)',    opacity: 1 }
      ], { duration: 280, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' });
      this._visible = true;
    } else if (n === 0 && this._visible) {
      this._el.animate([
        { transform: 'translateY(0) translateX(-50%)',    opacity: 1 },
        { transform: 'translateY(100%) translateX(-50%)', opacity: 0 }
      ], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {
        this._el.style.display = 'none';
      });
      this._visible = false;
    }

    this._el.querySelector('#bulk-count').textContent = `${n} selected`;
  }

  _handleAction(action) {
    const ids = this.selection.ids;
    if (ids.length === 0) return;

    if (action === 'delete') {
      if (!confirm(`Permanently delete ${ids.length} Gots and their files?`)) return;
      this.onAction({ action, ids, tags: [], add: [], remove: [] });
      return;
    }

    if (action === 'manage_tags') {
      this._openManageTags(ids);
      return;
    }

    if (action === 'move_to_tags') {
      this._openMoveToTag(ids);
    }
  }

  _openManageTags(ids) {
    document.getElementById('bulk-tag-prompt')?.remove();

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const images         = this.getTags();
    const selectedImages = images.filter(img => ids.includes(img.id));
    const total          = selectedImages.length;

    // Count occurrences of each tag across selected images
    // image.tags is an array of name strings
    const tagCounts = new Map();
    for (const img of selectedImages) {
      for (const name of (img.tags || [])) {
        tagCounts.set(name, (tagCounts.get(name) || 0) + 1);
      }
    }

    // Full tags first, then partial, both alphabetical within group
    const existingTags = [...tagCounts.entries()]
      .sort((a, b) => {
        const aFull = a[1] === total, bFull = b[1] === total;
        if (bFull && !aFull) return 1;
        if (aFull && !bFull) return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, count]) => ({ name, count, full: count === total }));

    const tagsToRemove  = new Set();
    const tagsToAdd     = new Set();
    const tagsToPromote = new Set();

    const prompt = document.createElement('div');
    prompt.id = 'bulk-tag-prompt';
    prompt.innerHTML = `
      <div id="bulk-tag-backdrop"></div>
      <div id="bulk-tag-dialog" class="manage-tags-dialog">
        <div id="manage-tags-header">
          <span id="manage-tags-title">Manage Tags</span>
          <span id="manage-tags-subtitle">${total} Got${total !== 1 ? 's' : ''} selected</span>
        </div>
        <div id="manage-tags-current">
          <div class="manage-tags-section-label">Current tags — click to remove; ◐ click once to add all, twice to remove</div>
          <div id="manage-tags-pills"></div>
        </div>
        <div id="manage-tags-add-section">
          <div class="manage-tags-section-label">Add tags</div>
          <div id="manage-tags-input-wrap">
            <input type="text" id="manage-tags-input" class="detail-add-tag-input" placeholder="type tag name and press Enter…" autocomplete="off" />
            <div id="manage-tags-suggestions" hidden></div>
          </div>
          <div id="manage-tags-pending"></div>
        </div>
        <div id="bulk-tag-dialog-actions">
          <button id="bulk-tag-cancel" class="btn">Cancel</button>
          <button id="bulk-tag-confirm" class="btn btn-primary" disabled>Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(prompt);

    const pillsWrap     = document.getElementById('manage-tags-pills');
    const pendingWrap   = document.getElementById('manage-tags-pending');
    const applyBtn      = document.getElementById('bulk-tag-confirm');
    const input         = document.getElementById('manage-tags-input');
    const suggestionsEl = document.getElementById('manage-tags-suggestions');

    const resolveColor = (name) => {
      const defs = this.getTagDefs();
      const t = defs.find(d => d.name === name);
      return t?.color || getTagColor(name);
    };

    const updateApply = () => {
      applyBtn.disabled = (tagsToRemove.size + tagsToAdd.size + tagsToPromote.size) === 0;
    };

    const renderPills = () => {
      pillsWrap.innerHTML = '';
      if (existingTags.length === 0) {
        pillsWrap.innerHTML = '<span class="manage-tags-empty">No tags on selected Gots</span>';
        return;
      }
      for (const { name, full } of existingTags) {
        const pill  = document.createElement('button');
        pill.type   = 'button';
        pill.className = 'mt-pill';
        pill.dataset.tag = name;
        const color = resolveColor(name);

        if (tagsToRemove.has(name)) {
          pill.classList.add('mt-pill-remove');
          pill.title = full
            ? 'Queued for removal — click to undo'
            : 'Queued for removal — click to undo';
          pill.innerHTML = `<span class="mt-pill-icon">−</span>${esc(name)}`;
        } else if (!full && tagsToPromote.has(name)) {
          pill.classList.add('mt-pill-promote');
          pill.style.background = color;
          pill.title = 'Will add to all — click again to remove instead';
          pill.innerHTML = `<span class="mt-pill-icon">↑</span>${esc(name)}`;
        } else if (!full) {
          pill.classList.add('mt-pill-partial');
          pill.style.background = color;
          pill.title = `On ${tagCounts.get(name)}/${total} Gots — click to add to all, click again to remove`;
          pill.innerHTML = `<span class="mt-pill-icon">◐</span>${esc(name)}`;
        } else {
          pill.classList.add('mt-pill-full');
          pill.style.background = color;
          pill.title = 'On all selected Gots — click to remove';
          pill.textContent = name;
        }

        pill.addEventListener('click', () => {
          if (full) {
            // Full tag: toggle removal
            if (tagsToRemove.has(name)) tagsToRemove.delete(name);
            else tagsToRemove.add(name);
          } else {
            // Partial tag: cycle unqueued → promote → remove → unqueued
            if (tagsToRemove.has(name)) {
              tagsToRemove.delete(name);
            } else if (tagsToPromote.has(name)) {
              tagsToPromote.delete(name);
              tagsToRemove.add(name);
            } else {
              tagsToPromote.add(name);
            }
          }
          renderPills();
          updateApply();
        });

        pillsWrap.appendChild(pill);
      }
    };

    const renderPending = () => {
      pendingWrap.innerHTML = '';
      for (const name of tagsToAdd) {
        const pill = document.createElement('span');
        pill.className = 'mt-pill mt-pill-add';
        const color = resolveColor(name);
        pill.style.background = color;
        pill.innerHTML = `<span class="mt-pill-icon">+</span>${esc(name)}<button type="button" class="detail-tag-remove" title="Remove">&times;</button>`;
        pill.querySelector('.detail-tag-remove').addEventListener('click', () => {
          tagsToAdd.delete(name);
          renderPending();
          updateApply();
        });
        pendingWrap.appendChild(pill);
      }
    };

    let activeIndex = -1;

    const setActive = (index) => {
      const items = suggestionsEl.querySelectorAll('.mt-suggestion');
      items.forEach((item, i) => item.classList.toggle('active', i === index));
      activeIndex = index;
      if (items[index]) items[index].scrollIntoView({ block: 'nearest' });
    };

    const showSuggestions = (val) => {
      suggestionsEl.innerHTML = '';
      activeIndex = -1;
      if (!val.trim()) { suggestionsEl.hidden = true; return; }
      const defs  = this.getTagDefs();
      const lower = val.toLowerCase();
      const matches = defs
        .filter(t => t.name.toLowerCase().includes(lower) && !tagsToAdd.has(t.name))
        .slice(0, 8);
      if (matches.length === 0) { suggestionsEl.hidden = true; return; }
      suggestionsEl.hidden = false;
      for (const t of matches) {
        const item = document.createElement('div');
        item.className = 'mt-suggestion';
        item.textContent = t.name;
        item.style.setProperty('--sug-dot', t.color || getTagColor(t.name));
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          addTag(t.name);
          input.value = '';
          suggestionsEl.hidden = true;
          activeIndex = -1;
        });
        suggestionsEl.appendChild(item);
      }
    };

    const addTag = (name) => {
      name = name.trim().toLowerCase();
      if (!name || tagsToAdd.has(name)) return;
      tagsToAdd.add(name);
      renderPending();
      updateApply();
    };

    input.addEventListener('input', () => showSuggestions(input.value));
    input.addEventListener('keydown', e => {
      const items = suggestionsEl.querySelectorAll('.mt-suggestion');
      const count = items.length;
      const visible = !suggestionsEl.hidden && count > 0;

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
        e.preventDefault();
        if (visible && activeIndex >= 0 && items[activeIndex]) {
          addTag(items[activeIndex].textContent);
          input.value = '';
          suggestionsEl.hidden = true;
          activeIndex = -1;
        } else {
          const val = input.value.trim();
          if (val) { addTag(val); input.value = ''; suggestionsEl.hidden = true; }
        }
        return;
      }

      if (e.key === 'Tab' && visible && activeIndex >= 0 && items[activeIndex]) {
        e.preventDefault();
        addTag(items[activeIndex].textContent);
        input.value = '';
        suggestionsEl.hidden = true;
        activeIndex = -1;
        return;
      }

      if (e.key === 'Escape') {
        if (visible) { suggestionsEl.hidden = true; activeIndex = -1; }
        else { prompt.remove(); }
        return;
      }
    });
    input.focus();

    renderPills();

    const apply = () => {
      const add    = [...tagsToAdd, ...tagsToPromote];
      const remove = [...tagsToRemove];
      if (add.length === 0 && remove.length === 0) return;
      prompt.remove();
      this.onAction({ action: 'manage_tags', ids, add, remove, tags: [] });
    };

    applyBtn.addEventListener('click', apply);
    document.getElementById('bulk-tag-cancel').addEventListener('click', () => prompt.remove());
    document.getElementById('bulk-tag-backdrop').addEventListener('click', () => prompt.remove());
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { prompt.remove(); document.removeEventListener('keydown', onKey); }
    });
  }

  _openMoveToTag(ids) {
    document.getElementById('bulk-tag-prompt')?.remove();

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const makePill = (name) => {
      const defs  = this.getTagDefs();
      const t     = defs.find(d => d.name === name);
      const color = t?.color || getTagColor(name);
      const pill  = document.createElement('span');
      pill.className   = 'detail-tag-pill';
      pill.dataset.tag = name;
      if (color) pill.style.background = color;
      pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
      pill.querySelector('.detail-tag-remove').addEventListener('click', () => pill.remove());
      return pill;
    };

    const prompt = document.createElement('div');
    prompt.id = 'bulk-tag-prompt';
    prompt.innerHTML = `
      <div id="bulk-tag-backdrop"></div>
      <div id="bulk-tag-dialog">
        <p>Replace all tags on ${ids.length} Got${ids.length !== 1 ? 's' : ''} with:</p>
        <div class="detail-tags-wrap" id="bulk-tags-wrap">
          <input type="text" class="detail-add-tag-input" id="bulk-tag-input" placeholder="+ add tag" autofocus />
        </div>
        <div id="bulk-tag-dialog-actions">
          <button id="bulk-tag-cancel" class="btn">Cancel</button>
          <button id="bulk-tag-confirm" class="btn btn-primary">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(prompt);
    document.getElementById('bulk-tag-input').focus();

    const getPills = () =>
      [...document.querySelectorAll('#bulk-tags-wrap .detail-tag-pill')].map(el => el.dataset.tag);

    document.getElementById('bulk-tag-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) {
          const wrap  = document.getElementById('bulk-tags-wrap');
          const input = document.getElementById('bulk-tag-input');
          if (!getPills().includes(val)) wrap.insertBefore(makePill(val), input);
          e.target.value = '';
        }
      }
      if (e.key === 'Escape') prompt.remove();
    });

    const apply = () => {
      const tags = getPills();
      if (tags.length === 0) return;
      if (!confirm(`This will replace all tags on ${ids.length} Gots. Continue?`)) return;
      prompt.remove();
      this.onAction({ action: 'move_to_tags', ids, tags, add: [], remove: [] });
    };

    document.getElementById('bulk-tag-confirm').addEventListener('click', apply);
    document.getElementById('bulk-tag-cancel').addEventListener('click', () => prompt.remove());
    document.getElementById('bulk-tag-backdrop').addEventListener('click', () => prompt.remove());
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { prompt.remove(); document.removeEventListener('keydown', onKey); }
    });
  }
}
