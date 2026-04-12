'use strict';

import { getTagColor } from './utils/tagColor.js';

export class BulkActionBar {
  constructor({ selection, onAction, getTags }) {
    this.selection = selection;
    this.onAction  = onAction;
    this.getTags   = getTags || (() => []);
    this._el       = null;
    this._visible  = false;

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
        <button class="bulk-btn" data-action="add_tags">Add Tags</button>
        <button class="bulk-btn" data-action="remove_tags">Remove Tags</button>
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
      this.onAction({ action, ids, tags: [] });
      return;
    }

    this._promptTags(action, ids);
  }

  _promptTags(action, ids) {
    document.getElementById('bulk-tag-prompt')?.remove();

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const makePill = (name, onRemove) => {
      const tags  = this.getTags();
      const t     = tags.find(t => t.name === name);
      const color = t?.color || getTagColor(name);
      const pill  = document.createElement('span');
      pill.className   = 'detail-tag-pill';
      pill.dataset.tag = name;
      if (color) pill.style.background = color;
      pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
      pill.querySelector('.detail-tag-remove').addEventListener('click', () => {
        pill.remove();
        if (onRemove) onRemove(name);
      });
      return pill;
    };

    if (action === 'remove_tags') {
      const tags        = this.getTags();
      const selectedImages = tags.length > 0
        ? tags.filter(img => ids.includes(img.id))
        : [];
      const unionTags = [...new Set(selectedImages.flatMap(img => img.tags || []))].sort();

      const prompt = document.createElement('div');
      prompt.id = 'bulk-tag-prompt';
      prompt.innerHTML = `
        <div id="bulk-tag-backdrop"></div>
        <div id="bulk-tag-dialog">
          <p>Click &times; to remove tags from ${ids.length} Got${ids.length !== 1 ? 's' : ''}.</p>
          <div class="detail-tags-wrap" id="bulk-tags-wrap"></div>
          <div id="bulk-tag-dialog-actions">
            <button id="bulk-tag-cancel">Cancel</button>
            <button id="bulk-tag-confirm">Apply</button>
          </div>
        </div>
      `;
      document.body.appendChild(prompt);

      const removedTags = new Set();
      const wrap = document.getElementById('bulk-tags-wrap');

      if (unionTags.length === 0) {
        wrap.innerHTML = '<span style="font-size:12px;color:var(--ink-dim)">No tags on selected Gots.</span>';
      } else {
        for (const name of unionTags) {
          wrap.appendChild(makePill(name, removed => removedTags.add(removed)));
        }
      }

      const apply = () => {
        if (removedTags.size === 0) return;
        prompt.remove();
        this.onAction({ action, ids, tags: [...removedTags] });
      };

      document.getElementById('bulk-tag-confirm').addEventListener('click', apply);
      document.getElementById('bulk-tag-cancel').addEventListener('click', () => prompt.remove());
      document.getElementById('bulk-tag-backdrop').addEventListener('click', () => prompt.remove());
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { prompt.remove(); document.removeEventListener('keydown', onKey); }
      });
      return;
    }

    const labels = {
      add_tags:     'Add tags to selected Gots:',
      move_to_tags: `Replace all tags on ${ids.length} Got${ids.length !== 1 ? 's' : ''} with:`,
    };

    const prompt = document.createElement('div');
    prompt.id = 'bulk-tag-prompt';
    prompt.innerHTML = `
      <div id="bulk-tag-backdrop"></div>
      <div id="bulk-tag-dialog">
        <p>${labels[action]}</p>
        <div class="detail-tags-wrap" id="bulk-tags-wrap">
          <input type="text" class="detail-add-tag-input" id="bulk-tag-input" placeholder="+ add tag" autofocus />
        </div>
        <div id="bulk-tag-dialog-actions">
          <button id="bulk-tag-cancel">Cancel</button>
          <button id="bulk-tag-confirm">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(prompt);
    document.getElementById('bulk-tag-input').focus();

    const getPills = () =>
      [...document.querySelectorAll('#bulk-tags-wrap .detail-tag-pill')].map(el => el.dataset.tag);

    const addPill = (name) => {
      const wrap  = document.getElementById('bulk-tags-wrap');
      const input = document.getElementById('bulk-tag-input');
      if (getPills().includes(name)) return;
      wrap.insertBefore(makePill(name), input);
    };

    document.getElementById('bulk-tag-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) { addPill(val); e.target.value = ''; }
      }
      if (e.key === 'Escape') prompt.remove();
    });

    const apply = () => {
      const tags = getPills();
      if (tags.length === 0) return;
      if (action === 'move_to_tags') {
        if (!confirm(`This will replace all tags on ${ids.length} Gots. Continue?`)) return;
      }
      prompt.remove();
      this.onAction({ action, ids, tags });
    };

    document.getElementById('bulk-tag-confirm').addEventListener('click', apply);
    document.getElementById('bulk-tag-cancel').addEventListener('click', () => prompt.remove());
    document.getElementById('bulk-tag-backdrop').addEventListener('click', () => prompt.remove());
  }
}
