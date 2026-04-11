'use strict';

// BulkActionBar — floating action bar that appears when images are selected
class BulkActionBar {
  constructor({ selection, onAction }) {
    this.selection = selection;
    this.onAction  = onAction;
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

    // Tag actions need a tag input
    this._promptTags(action, ids);
  }

  _promptTags(action, ids) {
    // Remove any existing prompt
    document.getElementById('bulk-tag-prompt')?.remove();

    const labels = {
      add_tags:     'Add tags to selected Gots:',
      remove_tags:  'Remove tags from selected Gots:',
      move_to_tags: 'Replace all tags on selected Gots with:',
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

    const getBulkTags = () => {
      return [...document.querySelectorAll('#bulk-tags-wrap .detail-tag-pill')]
        .map(el => el.dataset.tag);
    };

    const addBulkPill = (name) => {
      const wrap  = document.getElementById('bulk-tags-wrap');
      const input = document.getElementById('bulk-tag-input');
      if (getBulkTags().includes(name)) return; // no dupes

      const t     = (typeof state !== 'undefined' && state.tags)
        ? state.tags.find(t => t.name === name) : null;
      const color = t?.color || (typeof getTagColor === 'function' ? getTagColor(name) : '');

      const pill = document.createElement('span');
      pill.className = 'detail-tag-pill';
      pill.dataset.tag = name;
      if (color) pill.style.background = color;

      const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
      pill.querySelector('.detail-tag-remove').addEventListener('click', () => pill.remove());

      wrap.insertBefore(pill, input);
    };

    document.getElementById('bulk-tag-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) { addBulkPill(val); e.target.value = ''; }
      }
      if (e.key === 'Escape') prompt.remove();
    });

    const apply = () => {
      const tags = getBulkTags();
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

window.BulkActionBar = BulkActionBar;
