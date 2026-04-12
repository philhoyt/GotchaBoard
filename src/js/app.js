import '@fontsource/syne/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '../styles/main.scss';

import { toggleTheme }    from './utils/theme.js';
import { getTagColor }    from './utils/tagColor.js';
import { calcColumnWidth, DEFAULT_CARD_WIDTH, initMasonry, layoutAfterImages } from './utils/grid.js';
import { sweep }          from './animations.js';
import { SelectionManager } from './multiselect.js';
import { DragStack }      from './dragStack.js';
import { BulkActionBar }  from './bulkActions.js';
import { initImportModal } from './importModal.js';

'use strict';

const API = window.location.origin + '/api';

// ── State ──────────────────────────────────────────────────────────
const state = {
  images:      [],
  tags:        [],
  collections: [],

  activeTags:       [],
  activeCollection: null,
  showUntagged:     false,
  searchQuery:      '',
  sortOrder:        'saved_at_desc',

  detailImageId: null,
};

// ── Utilities ──────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : s; }

function toast(msg, duration = 2800) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

// ── Data loading ───────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadImages(), loadTags(), loadCollections()]);
}

async function loadImages() {
  const params = new URLSearchParams();

  if (state.showUntagged) {
    params.set('untagged', '1');
  } else if (state.activeCollection) {
    params.set('collection', state.activeCollection);
  } else if (state.activeTags.length === 1) {
    params.set('tag_id', state.activeTags[0]);
  } else if (state.activeTags.length > 1) {
    const names = state.activeTags.map(id => {
      const t = state.tags.find(t => t.id === id);
      return t ? t.name : '';
    }).filter(Boolean);
    params.set('tags', names.join(','));
  }

  if (state.searchQuery) params.set('q', state.searchQuery);

  const images = await apiFetch('/images' + (params.toString() ? '?' + params : ''));
  if (state.sortOrder === 'saved_at_asc') images.reverse();
  state.images = images;
  renderGrid();
  updateCounts();
}

async function loadTags() {
  state.tags = await apiFetch('/tags');
  renderTagList();
}

async function loadCollections() {
  state.collections = await apiFetch('/smart-collections');
  renderCollections();
}

// ── Grid rendering ─────────────────────────────────────────────────
let msnry = null;

function updateCardWidth() {
  const scroll = document.getElementById('grid-scroll');
  const innerWidth = scroll.clientWidth - 24; // subtract 12px left + 12px right padding
  const targetWidth = Number(localStorage.getItem('gotcha-card-width')) || DEFAULT_CARD_WIDTH;
  const actualWidth = calcColumnWidth(innerWidth, targetWidth);
  const grid = document.getElementById('image-grid');
  grid.style.setProperty('--card-width', actualWidth + 'px');
  grid.classList.toggle('compact-grid', actualWidth < 140);
  return actualWidth;
}

function renderGrid() {
  const grid  = document.getElementById('image-grid');
  const empty = document.getElementById('empty-state');

  if (state.images.length === 0) {
    grid.style.display = 'none'; grid.innerHTML = '';
    empty.classList.add('visible');
    if (msnry) { msnry.destroy(); msnry = null; }
    return;
  }

  grid.style.display = '';
  empty.classList.remove('visible');

  if (msnry) { msnry.destroy(); msnry = null; }
  grid.innerHTML = '';
  updateCardWidth();

  const sizer = document.createElement('div');
  sizer.className = 'grid-sizer';
  grid.appendChild(sizer);

  state.images.forEach((image, idx) => grid.appendChild(buildCard(image, idx)));

  msnry = initMasonry(grid, '.image-card');
  layoutAfterImages(grid, msnry);

  syncSelectionUI();
  renderActiveFilters();
}

function buildCard(image, idx) {
  const card = document.createElement('div');
  card.className = 'image-card' + (selection.has(image.id) ? ' selected' : '');
  card.dataset.id  = image.id;
  card.dataset.idx = idx;

  const thumb = (image.thumbnail && image.thumbnail !== 'error' && image.thumbnail !== 'placeholder')
    ? `/thumbs/${image.thumbnail}` : null;

  const tagBadges = (image.tags || []).slice(0, 3).map(name => {
    const t     = state.tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const style = color ? `style="background:${esc(color)}"` : '';
    return `<span class="tag-badge" ${style}>${esc(name)}</span>`;
  }).join('');

  let title = image.page_title;
  if (!title) { try { title = new URL(image.source_url).hostname; } catch (_) { title = ''; } }

  card.innerHTML = `
    <div class="card-select-zone"><div class="card-checkbox"></div></div>
    <div class="card-inner">
      ${thumb ? `<img src="${esc(thumb)}" alt="${esc(title)}" loading="lazy">` : '<div style="height:100px;background:#f3f4f6"></div>'}
      <div class="card-meta">
        <div class="card-title">${esc(title)}</div>
        ${tagBadges ? `<div class="card-badges">${tagBadges}</div>` : ''}
      </div>
    </div>
  `;

  card.querySelector('.card-select-zone').addEventListener('click', e => {
    e.stopPropagation();
    if (e.shiftKey && selection.lastIndex !== null) {
      const ids = state.images.map(i => i.id);
      selection.rangeSelect(ids, selection.lastIndex, idx);
    } else {
      selection.toggle(image.id, idx);
    }
    syncSelectionUI();
  });

  card.querySelector('.card-inner').addEventListener('click', e => {
    if (e.target.closest('.card-select-zone')) return;
    openDetail(image.id);
  });

  card.addEventListener('mousedown', e => {
    if (e.target.closest('.card-select-zone')) return;
    if (selection.has(image.id)) {
      dragStack.prime(e, card, document.querySelectorAll('.image-card'));
    }
  });

  return card;
}

function syncSelectionUI() {
  const hasAny = selection.size > 0;
  document.getElementById('app').classList.toggle('any-selected', hasAny);
  document.querySelectorAll('.image-card').forEach(card => {
    card.classList.toggle('selected', selection.has(card.dataset.id));
  });
}

// ── Tag list rendering ─────────────────────────────────────────────
function renderTagList() {
  const list = document.getElementById('tags-list');
  list.innerHTML = '';

  const parents  = state.tags.filter(t => !t.parent_id);
  const children = state.tags.filter(t => t.parent_id);

  const childrenByParent = {};
  children.forEach(c => { (childrenByParent[c.parent_id] ||= []).push(c); });

  for (const parent of parents) {
    list.appendChild(buildTagItem(parent, false));
    const kids = childrenByParent[parent.id] || [];
    for (const child of kids) list.appendChild(buildTagItem(child, true));
  }
}

function buildTagItem(tag, isChild) {
  const li = document.createElement('li');
  li.className = 'tag-item' + (isChild ? ' child-tag' : '');

  const isActive = state.activeTags.includes(tag.id);
  const isMulti  = state.activeTags.length > 1 && isActive;
  if (isActive) li.classList.add(isMulti ? 'multi-active' : 'active');
  li.dataset.tagId = tag.id;

  const tagColor = tag.color || getTagColor(tag.name);
  if (tagColor && !isActive) li.style.background = tagColor;

  li.innerHTML = `
    <span class="tag-dot"></span>
    <span class="tag-name">${esc(tag.name)}</span>
    <span class="tag-count">${tag.count || 0}</span>
    <span class="tag-actions">
      <button class="tag-action-btn delete" title="Delete">✕</button>
    </span>
  `;

  li.querySelector('.tag-name').addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey) {
      if (state.activeTags.includes(tag.id)) {
        state.activeTags = state.activeTags.filter(id => id !== tag.id);
      } else {
        state.activeTags = [...state.activeTags, tag.id];
      }
    } else {
      state.activeTags = state.activeTags[0] === tag.id && state.activeTags.length === 1
        ? [] : [tag.id];
    }
    state.showUntagged = false;
    state.activeCollection = null;
    document.getElementById('all-images-btn').classList.remove('active');
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    loadImages();
  });

  li.querySelector('.delete').addEventListener('click', e => {
    e.stopPropagation();
    confirmDeleteTag(tag);
  });

  return li;
}

// ── Collections rendering ──────────────────────────────────────────
function renderCollections() {
  const list = document.getElementById('collections-list');
  list.innerHTML = '';

  if (state.collections.length === 0) {
    list.innerHTML = '<li style="padding:4px 10px;font-size:11px;color:var(--text-muted)">No collections yet</li>';
    return;
  }

  for (const col of state.collections) {
    const li = document.createElement('li');
    li.className = 'collection-item' + (state.activeCollection === col.id ? ' active' : '');
    li.dataset.id = col.id;
    li.innerHTML = `
      <span class="collection-icon">◎</span>
      <span class="collection-name">${esc(col.name)}</span>
      <button class="collection-delete" title="Delete">✕</button>
    `;

    li.querySelector('.collection-name').addEventListener('click', () => {
      state.activeCollection = state.activeCollection === col.id ? null : col.id;
      state.activeTags = [];
      state.showUntagged = false;
      document.getElementById('all-images-btn').classList.toggle('active', !state.activeCollection);
      document.getElementById('untagged-btn').classList.remove('active');
      renderCollections();
      renderTagList();
      loadImages();
    });

    li.querySelector('.collection-delete').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`Delete collection "${col.name}"?`)) return;
      try {
        await apiFetch(`/smart-collections/${col.id}`, { method: 'DELETE' });
        if (state.activeCollection === col.id) { state.activeCollection = null; loadImages(); }
        await loadCollections();
      } catch (err) { alert(err.message); }
    });

    list.appendChild(li);
  }
}

// ── Active filters display ─────────────────────────────────────────
function renderActiveFilters() {
  const container = document.getElementById('active-filters');
  container.innerHTML = '';

  if (state.activeTags.length > 0) {
    state.activeTags.forEach(tagId => {
      const t = state.tags.find(t => t.id === tagId);
      if (!t) return;
      container.appendChild(buildFilterChip(`#${t.name}`, () => {
        state.activeTags = state.activeTags.filter(id => id !== tagId);
        if (state.activeTags.length === 0) document.getElementById('all-images-btn').classList.add('active');
        renderTagList();
        loadImages();
      }));
    });
  }

  if (state.activeCollection) {
    const col = state.collections.find(c => c.id === state.activeCollection);
    if (col) {
      container.appendChild(buildFilterChip(`◎ ${col.name}`, () => {
        state.activeCollection = null;
        document.getElementById('all-images-btn').classList.add('active');
        renderCollections();
        loadImages();
      }));
    }
  }

  if (state.showUntagged) {
    container.appendChild(buildFilterChip('Untagged', () => {
      state.showUntagged = false;
      document.getElementById('all-images-btn').classList.add('active');
      document.getElementById('untagged-btn').classList.remove('active');
      loadImages();
    }));
  }

  if (state.searchQuery) {
    container.appendChild(buildFilterChip(`"${state.searchQuery}"`, () => {
      state.searchQuery = '';
      document.getElementById('search-input').value = '';
      loadImages();
    }));
  }
}

function buildFilterChip(label, onRemove) {
  const chip = document.createElement('span');
  chip.className = 'filter-chip';
  chip.innerHTML = `${esc(label)} <button>&times;</button>`;
  chip.querySelector('button').addEventListener('click', onRemove);
  return chip;
}

// ── Count badges ───────────────────────────────────────────────────
async function updateCounts() {
  const all = await apiFetch('/images').catch(() => []);
  document.getElementById('all-images-btn').dataset.count = all.length;
  document.getElementById('saved-count') && (document.getElementById('saved-count').textContent = `${all.length} saved`);

  const untagged = await apiFetch('/images?untagged=1').catch(() => []);
  document.getElementById('untagged-btn').dataset.count = untagged.length;
}

// ── Detail panel ───────────────────────────────────────────────────
async function openDetail(imageId) {
  state.detailImageId = imageId;
  const image = await apiFetch(`/images/${imageId}`);

  const panel   = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const content = document.getElementById('detail-content');

  content.innerHTML = buildDetailHTML(image);
  panel.classList.add('open');
  overlay.classList.add('open');
  bindDetailEvents(image);
}

function buildDetailHTML(image) {
  const saved   = new Date(image.saved_at).toLocaleString();
  const imgSrc  = image.filename ? `/images/${image.filename}` : null;
  const imageTags = image.tags || [];

  const tagPills = imageTags.map(name => {
    const t     = state.tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const style = color ? `style="background:${esc(color)}"` : '';
    return `<span class="detail-tag-pill" data-tag="${esc(name)}" ${style}>${esc(name)}<button class="detail-tag-remove" title="Remove tag">&times;</button></span>`;
  }).join('');

  return `
    <div class="detail-image-wrap">
      ${imgSrc ? `<img src="${esc(imgSrc)}" alt="${esc(image.page_title || '')}">` : '<div style="height:120px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:12px;color:#9ca3af">No preview</div>'}
    </div>
    <div class="detail-field">
      <div class="detail-label">Source</div>
      <div class="detail-value-url"><a href="${esc(image.source_url)}" target="_blank" rel="noopener" title="${esc(image.source_url)}">${esc(image.source_url)}</a></div>
    </div>
    ${image.page_title ? `<div class="detail-field"><div class="detail-label">Page Title</div><div class="detail-value">${esc(image.page_title)}</div></div>` : ''}
    ${image.page_url   ? `<div class="detail-field"><div class="detail-label">Page URL</div><div class="detail-value-url"><a href="${esc(image.page_url)}" target="_blank" rel="noopener" title="${esc(image.page_url)}">${esc(image.page_url)}</a></div></div>` : ''}
    ${image.pin_url    ? `<div class="detail-field"><div class="detail-label">Pinterest Pin</div><div class="detail-value-url"><a href="${esc(image.pin_url)}" target="_blank" rel="noopener" title="${esc(image.pin_url)}">${esc(image.pin_url)}</a></div></div>` : ''}
    <div class="detail-field"><div class="detail-label">Saved</div><div class="detail-value">${esc(saved)}</div></div>
    <div class="detail-field">
      <div class="detail-label">Tags</div>
      <div class="detail-tags-wrap" id="detail-tags-wrap">
        ${tagPills}
        <input type="text" class="detail-add-tag-input" id="detail-add-tag" placeholder="+ add tag" />
      </div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-ghost" id="detail-open-source">Open Source</button>
      <button class="btn btn-danger" id="detail-delete">Delete</button>
    </div>
  `;
}

function getDetailTags() {
  return [...document.querySelectorAll('#detail-tags-wrap .detail-tag-pill')]
    .map(el => el.dataset.tag);
}

async function saveDetailTags(imageId) {
  try {
    await apiFetch(`/images/${imageId}`, { method: 'PATCH', body: JSON.stringify({ tags: getDetailTags() }) });
    await Promise.all([loadImages(), loadTags()]);
  } catch (err) {
    toast('Failed to save tags');
  }
}

function addDetailTagPill(name, imageId) {
  const wrap  = document.getElementById('detail-tags-wrap');
  const input = document.getElementById('detail-add-tag');
  const t     = state.tags.find(t => t.name === name);
  const color = t?.color || getTagColor(name);

  const pill = document.createElement('span');
  pill.className = 'detail-tag-pill';
  pill.dataset.tag = name;
  if (color) pill.style.background = color;
  pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove tag">&times;</button>`;
  pill.querySelector('.detail-tag-remove').addEventListener('click', () => {
    pill.remove();
    saveDetailTags(imageId);
  });

  wrap.insertBefore(pill, input);
}

function bindDetailEvents(image) {
  document.querySelectorAll('.detail-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.detail-tag-pill').remove();
      saveDetailTags(image.id);
    });
  });

  const addInput = document.getElementById('detail-add-tag');
  addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = addInput.value.trim();
      if (!val) return;
      if (getDetailTags().includes(val)) { addInput.value = ''; return; }
      addDetailTagPill(val, image.id);
      addInput.value = '';
      saveDetailTags(image.id);
    }
    if (e.key === 'Escape') addInput.blur();
  });

  document.getElementById('detail-open-source').addEventListener('click', () => window.open(image.source_url, '_blank', 'noopener'));

  document.getElementById('detail-delete').addEventListener('click', async () => {
    if (!confirm('Delete this Got? This cannot be undone.')) return;
    try {
      await apiFetch(`/images/${image.id}`, { method: 'DELETE' });
      closeDetail();
      await Promise.all([loadImages(), loadTags()]);
    } catch (err) { alert(`Failed to delete: ${err.message}`); }
  });
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-overlay').classList.remove('open');
  state.detailImageId = null;
}

// ── Tag management (inline) ────────────────────────────────────────
async function confirmDeleteTag(tag) {
  if (!confirm(`Delete tag "${tag.name}"? It will be removed from all Gots.`)) return;
  try {
    await apiFetch(`/tags/${tag.id}`, { method: 'DELETE' });
    state.activeTags = state.activeTags.filter(id => id !== tag.id);
    await Promise.all([loadImages(), loadTags()]);
  } catch (err) { alert(`Failed to delete tag: ${err.message}`); }
}

async function createTag(name) {
  try {
    await apiFetch('/tags', { method: 'POST', body: JSON.stringify({ name }) });
    await loadTags();
  } catch (err) { alert(`Failed to create tag: ${err.message}`); }
}

async function createCollection(name) {
  try {
    await apiFetch('/smart-collections', {
      method: 'POST',
      body: JSON.stringify({ name, tag_query: { operator: 'AND', tags: [] } })
    });
    await loadCollections();
  } catch (err) { alert(`Failed to create collection: ${err.message}`); }
}

// ── Bulk action handler ────────────────────────────────────────────
async function handleBulkAction({ action, ids, tags }) {
  try {
    await apiFetch('/gots/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, tags })
    });

    if (action === 'delete') {
      const cards = [...document.querySelectorAll('.image-card')]
        .filter(c => ids.includes(c.dataset.id));
      await Promise.all(cards.map((c, i) => sweep(c, i * 40).finished));
    }

    selection.clear();
    toast(action === 'delete' ? `Deleted ${ids.length} Gots` : `Updated ${ids.length} Gots`);
    await Promise.all([loadImages(), loadTags()]);
  } catch (err) { alert(`Bulk action failed: ${err.message}`); }
}

// ── Drag drop handler ──────────────────────────────────────────────
async function handleDrop(tagId, imageIds) {
  try {
    await apiFetch('/gots/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids: imageIds, action: 'add_tags', tags: [
        state.tags.find(t => t.id === tagId)?.name
      ].filter(Boolean) })
    });
    const tagName = state.tags.find(t => t.id === tagId)?.name || tagId;
    toast(`${imageIds.length} Got${imageIds.length > 1 ? 's' : ''} tagged → ${tagName}`);
    selection.clear();
    await Promise.all([loadImages(), loadTags()]);
  } catch (err) { alert(`Tag drop failed: ${err.message}`); }
}

// ── Module instances ───────────────────────────────────────────────
const selection = new SelectionManager();
const bulkBar   = new BulkActionBar({
  selection,
  onAction: handleBulkAction,
  getTags:  () => state.images,   // images carry .tags[], used by remove_tags prompt
});
const dragStack = new DragStack({
  selection,
  onDrop:         handleDrop,
  getDropTargets: () => document.querySelectorAll('[data-tag-id]')
});

selection.addEventListener('change', () => syncSelectionUI());

// ── Grid scale ─────────────────────────────────────────────────────
function setCardWidth(w) {
  document.querySelectorAll('.grid-scale-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.cardWidth) === w);
  });
  localStorage.setItem('gotcha-card-width', w);
  updateCardWidth();
  if (msnry) msnry.layout();
}

// ── Add Got modal ──────────────────────────────────────────────────
function openAddGotModal() {
  const modal  = document.getElementById('add-got-modal');
  const dialog = document.getElementById('add-got-dialog');
  let activeMode = 'url';
  let uploadFile = null;

  dialog.innerHTML = `
    <h2>+ New Got</h2>
    <div class="add-got-tabs">
      <button class="add-got-tab active" data-mode="url">Paste URL</button>
      <button class="add-got-tab" data-mode="upload">Upload File</button>
    </div>

    <div class="add-got-mode active" id="add-got-mode-url">
      <div class="add-got-field">
        <div class="detail-label">Image URL</div>
        <input type="url" id="add-got-url" placeholder="https://..." autocomplete="off">
      </div>
      <div class="add-got-field">
        <div class="detail-label">Page Title (optional)</div>
        <input type="text" id="add-got-page-title" placeholder="Where did you find this?" autocomplete="off">
      </div>
      <div class="add-got-field">
        <div class="detail-label">Page URL (optional)</div>
        <input type="url" id="add-got-page-url" placeholder="https://..." autocomplete="off">
      </div>
    </div>

    <div class="add-got-mode" id="add-got-mode-upload">
      <div class="add-got-dropzone" id="add-got-dropzone">
        <span id="add-got-drop-label">Drop image here or click to browse</span>
        <input type="file" id="add-got-file" accept="image/*" style="display:none">
      </div>
    </div>

    <hr class="add-got-divider">

    <div class="add-got-field">
      <div class="detail-label">Tags</div>
      <div class="detail-tags-wrap" id="add-got-tags-wrap">
        <input type="text" class="detail-add-tag-input" id="add-got-tag-input" placeholder="+ add tag">
      </div>
    </div>
    <div class="add-got-field">
      <div class="detail-label">Notes</div>
      <textarea id="add-got-notes" class="detail-textarea" placeholder="Add notes..."></textarea>
    </div>

    <div class="add-got-error" id="add-got-error"></div>
    <div class="add-got-actions">
      <button class="btn btn-primary" id="add-got-save">Save Got</button>
      <button class="btn btn-ghost" id="add-got-cancel">Cancel</button>
    </div>
  `;

  modal.style.display = 'flex';
  document.getElementById('add-got-url').focus();

  dialog.querySelectorAll('.add-got-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      activeMode = tab.dataset.mode;
      dialog.querySelectorAll('.add-got-tab').forEach(t => t.classList.toggle('active', t === tab));
      dialog.querySelectorAll('.add-got-mode').forEach(m => m.classList.toggle('active', m.id === `add-got-mode-${activeMode}`));
      if (activeMode === 'url') document.getElementById('add-got-url').focus();
    });
  });

  const getModalTags = () =>
    [...dialog.querySelectorAll('#add-got-tags-wrap .detail-tag-pill')].map(el => el.dataset.tag);

  const addModalPill = (name) => {
    const wrap  = document.getElementById('add-got-tags-wrap');
    const input = document.getElementById('add-got-tag-input');
    if (getModalTags().includes(name)) return;
    const t     = state.tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const pill  = document.createElement('span');
    pill.className   = 'detail-tag-pill';
    pill.dataset.tag = name;
    if (color) pill.style.background = color;
    pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
    pill.querySelector('.detail-tag-remove').addEventListener('click', () => pill.remove());
    wrap.insertBefore(pill, input);
  };

  document.getElementById('add-got-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val) { addModalPill(val); e.target.value = ''; }
    }
  });

  document.getElementById('add-got-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
  });

  const dropzone  = document.getElementById('add-got-dropzone');
  const fileInput = document.getElementById('add-got-file');

  const setFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    uploadFile = file;
    const url = URL.createObjectURL(file);
    dropzone.innerHTML = `<img src="${url}" alt="preview"><input type="file" id="add-got-file" accept="image/*" style="display:none">`;
    dropzone.querySelector('#add-got-file').addEventListener('change', e => setFile(e.target.files[0]));
  };

  dropzone.addEventListener('click', () => document.getElementById('add-got-file').click());
  fileInput.addEventListener('change', e => setFile(e.target.files[0]));
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    setFile(e.dataTransfer.files[0]);
  });

  const showError = (msg) => { document.getElementById('add-got-error').textContent = msg; };

  const doSave = async () => {
    showError('');
    const saveBtn = document.getElementById('add-got-save');
    const tags    = getModalTags();
    const notes   = document.getElementById('add-got-notes').value.trim() || null;

    if (activeMode === 'url') {
      const source_url = document.getElementById('add-got-url').value.trim();
      const page_title = document.getElementById('add-got-page-title').value.trim() || null;
      const page_url   = document.getElementById('add-got-page-url').value.trim() || null;
      if (!source_url) { showError('Image URL is required.'); return; }

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';
      try {
        await apiFetch('/images/save', {
          method: 'POST',
          body: JSON.stringify({ source_url, page_title, page_url, tags, notes }),
        });
        closeAddGotModal();
        await loadAll();
        toast('Got saved!');
      } catch (err) {
        showError(err.message);
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Got';
      }
    } else {
      if (!uploadFile) { showError('Please select an image file.'); return; }

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';
      try {
        const formData = new FormData();
        formData.append('image', uploadFile);
        if (tags.length)  formData.append('tags',  JSON.stringify(tags));
        if (notes)        formData.append('notes', notes);

        const res = await fetch(`${API}/images/upload`, { method: 'POST', body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        closeAddGotModal();
        await loadAll();
        toast('Got saved!');
      } catch (err) {
        showError(err.message);
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Save Got';
      }
    }
  };

  document.getElementById('add-got-save').addEventListener('click', doSave);
  document.getElementById('add-got-cancel').addEventListener('click', closeAddGotModal);
  document.getElementById('add-got-backdrop').addEventListener('click', closeAddGotModal);
}

function closeAddGotModal() {
  const modal = document.getElementById('add-got-modal');
  modal.style.display = 'none';
  document.getElementById('add-got-dialog').innerHTML = '';
}

// ── Settings helpers ───────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-panel').style.display   = '';
  document.getElementById('settings-overlay').style.display = '';
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn && themeBtn.classList.contains('ghost-btn')) {
    themeBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀ Light mode' : '☾ Dark mode';
  }
}

function closeSettings() {
  document.getElementById('settings-panel').style.display   = 'none';
  document.getElementById('settings-overlay').style.display = 'none';
  document.getElementById('delete-all-confirm').style.display = 'none';
  document.getElementById('delete-all-initial').style.display = '';
}

// ── Export / Import ────────────────────────────────────────────────
function exportData() {
  window.location.href = API.replace('/api', '') + '/api/transfer/export';
}

async function importData(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  const form = new FormData();
  form.append('file', file);

  try {
    toast('Importing…');
    const res  = await fetch(`${API}/transfer/import`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    toast(data.message || 'Import complete — reloading…');
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    toast('Import failed: ' + err.message);
  }
}

// ── Event listeners ────────────────────────────────────────────────
function bindEventListeners() {
  document.getElementById('all-images-btn').addEventListener('click', () => {
    state.activeTags = [];
    state.activeCollection = null;
    state.showUntagged = false;
    document.getElementById('all-images-btn').classList.add('active');
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    loadImages();
  });

  document.getElementById('untagged-btn').addEventListener('click', () => {
    state.showUntagged = !state.showUntagged;
    state.activeTags = [];
    state.activeCollection = null;
    document.getElementById('untagged-btn').classList.toggle('active', state.showUntagged);
    document.getElementById('all-images-btn').classList.toggle('active', !state.showUntagged);
    renderTagList();
    renderCollections();
    loadImages();
  });

  document.getElementById('search-input').addEventListener('input', debounce(e => {
    state.searchQuery = e.target.value.trim();
    loadImages();
  }, 300));

  document.getElementById('sort-select').addEventListener('change', e => {
    state.sortOrder = e.target.value;
    loadImages();
  });

  document.getElementById('select-all-btn').addEventListener('click', () => {
    if (selection.size === state.images.length) {
      selection.clear();
    } else {
      selection.selectAll(state.images.map(i => i.id));
    }
    syncSelectionUI();
  });

  document.getElementById('new-tag-btn').addEventListener('click', () => {
    const form = document.getElementById('new-tag-form');
    form.style.display = form.style.display === 'none' ? '' : 'none';
    if (form.style.display !== 'none') document.getElementById('new-tag-input').focus();
  });
  document.getElementById('new-tag-cancel').addEventListener('click', () => {
    document.getElementById('new-tag-form').style.display = 'none';
  });
  const saveNewTag = () => {
    const val = document.getElementById('new-tag-input').value.trim();
    if (!val) return;
    document.getElementById('new-tag-input').value = '';
    document.getElementById('new-tag-form').style.display = 'none';
    createTag(val);
  };
  document.getElementById('new-tag-save').addEventListener('click', saveNewTag);
  document.getElementById('new-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveNewTag();
    if (e.key === 'Escape') document.getElementById('new-tag-form').style.display = 'none';
  });

  document.getElementById('new-collection-btn').addEventListener('click', () => {
    const name = prompt('Collection name:');
    if (name?.trim()) createCollection(name.trim());
  });

  document.querySelectorAll('.grid-scale-btn').forEach(btn => {
    btn.addEventListener('click', () => setCardWidth(Number(btn.dataset.cardWidth)));
  });

  document.getElementById('add-got-btn').addEventListener('click', openAddGotModal);

  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  // Inline handlers converted to addEventListener
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.querySelector('[data-action="export"]')?.addEventListener('click', exportData);
  // Backup / Restore buttons
  document.querySelector('.export-btn')?.addEventListener('click', exportData);
  const restoreInput = document.querySelector('.restore-input');
  if (restoreInput) restoreInput.addEventListener('change', e => importData(e.target));

  document.getElementById('delete-all-btn').addEventListener('click', () => {
    document.getElementById('delete-all-initial').style.display = 'none';
    document.getElementById('delete-all-confirm').style.display = '';
  });
  document.getElementById('delete-all-cancel-btn').addEventListener('click', () => {
    document.getElementById('delete-all-confirm').style.display = 'none';
    document.getElementById('delete-all-initial').style.display = '';
  });
  document.getElementById('delete-all-confirm-btn').addEventListener('click', async () => {
    const btn = document.getElementById('delete-all-confirm-btn');
    btn.disabled    = true;
    btn.textContent = 'Deleting…';
    try {
      const res = await apiFetch('/images', { method: 'DELETE' });
      closeSettings();
      document.getElementById('delete-all-confirm').style.display = 'none';
      document.getElementById('delete-all-initial').style.display = '';
      await loadAll();
      toast(`Deleted ${res.deleted.toLocaleString()} Got${res.deleted !== 1 ? 's' : ''}`);
    } catch (err) {
      toast('Delete failed: ' + err.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Yes, delete all';
    }
  });

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', closeDetail);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('settings-panel').style.display !== 'none') { closeSettings(); return; }
    if (e.key === 'Escape' && document.getElementById('add-got-modal').style.display !== 'none') { closeAddGotModal(); return; }
    if (e.key === 'Escape' && state.detailImageId) closeDetail();
    if (e.key === 'Escape') selection.clear();
  });
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindEventListeners();
  initImportModal({ onDone: loadAll });

  const savedCardWidth = localStorage.getItem('gotcha-card-width');
  if (savedCardWidth) {
    document.querySelectorAll('.grid-scale-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.cardWidth) === Number(savedCardWidth));
    });
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      updateCardWidth();
      if (msnry) msnry.layout();
    }, 150);
  });

  loadAll().catch(() => {
    document.getElementById('image-grid').innerHTML = `
      <div style="padding:40px;text-align:center;color:#dc2626">
        <p>Could not connect to GotchaBoard server.</p>
        <p style="font-size:12px;margin-top:8px;color:#6b7280">Run <code>npm start</code> in the project directory.</p>
      </div>
    `;
    document.getElementById('image-grid').style.display = '';
  });
});
