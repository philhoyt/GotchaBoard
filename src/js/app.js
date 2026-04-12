import '@fontsource/syne/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '../styles/main.scss';

import { toggleTheme }    from './utils/theme.js';
import { getTagColor }    from './utils/tagColor.js';
import { attachTagSuggestions } from './utils/tagSuggest.js';
import { calcColumnWidth, DEFAULT_CARD_WIDTH, initMasonry } from './utils/grid.js';
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
  checkedTags:      [],    // tags selected via checkbox (multi-select OR filter)
  activeCollection: null,
  showUntagged:     false,
  searchQuery:      '',
  sortOrder:        'saved_at_desc',

  detailImageId: null,

  // Pagination
  page:        0,    // offset of next page to load
  pageSize:    60,
  totalImages: 0,
  loading:     false,
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

function buildImageQuery() {
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
  return params.toString();
}

async function loadImages(append = false) {
  if (state.loading) return;
  state.loading = true;

  const seq = ++_loadSeq;

  if (!append) {
    state.page = 0;
    document.getElementById('grid-scroll').scrollTop = 0;
  }

  try {
    const base = buildImageQuery();
    const params = new URLSearchParams(base);
    params.set('limit',  state.pageSize);
    params.set('offset', state.page);
    const data = await apiFetch('/images?' + params.toString());
    if (seq !== _loadSeq) return;

    const { images, total } = data;
    if (state.sortOrder === 'saved_at_asc') images.reverse();

    state.totalImages = total;

    if (append) {
      state.images = [...state.images, ...images];
      appendToGrid(images);
    } else {
      state.images = images;
      renderGrid();
    }

    state.page += images.length;
    updateCounts();
  } finally {
    state.loading = false;
  }
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
let msnry          = null;
let currentCardWidth = DEFAULT_CARD_WIDTH;
let layoutTimer    = null;
let _loadSeq       = 0;   // monotonic counter — stale loadImages() responses are discarded
let _renderingGrid = false; // true while renderGrid/appendToGrid is painting — blocks scroll loading
let _detailSuggest      = null;
let _addGotSuggest      = null;
let _collectionModal    = null;
let _collectionSuggest  = null;
let _editingCollectionId = null;

// Prefer requestIdleCallback so Masonry layout runs between frames (no forced-reflow
// violation, no main-thread blocking during user interactions). Fall back to setTimeout
// for browsers that don't support it, but keep a short deadline so the grid doesn't
// stay mis-positioned for long.
const _schedRIC  = window.requestIdleCallback
  ? (fn) => requestIdleCallback(fn, { timeout: 500 })
  : (fn) => setTimeout(fn, 100);
const _cancelRIC = window.cancelIdleCallback || clearTimeout;

function scheduleLayout() {
  if (layoutTimer) return;
  layoutTimer = _schedRIC(() => {
    layoutTimer = null;
    if (msnry) msnry.layout();
  });
}

function updateCardWidth() {
  const scroll = document.getElementById('grid-scroll');
  const innerWidth = scroll.clientWidth - 24; // subtract 12px left + 12px right padding
  const targetWidth = Number(localStorage.getItem('gotcha-card-width')) || DEFAULT_CARD_WIDTH;
  const actualWidth = calcColumnWidth(innerWidth, targetWidth);
  currentCardWidth  = actualWidth;
  const grid = document.getElementById('image-grid');
  grid.style.setProperty('--card-width', actualWidth + 'px');
  grid.classList.toggle('compact-grid', actualWidth < 140);
  return actualWidth;
}

function renderGrid() {
  _renderingGrid = true;

  const grid  = document.getElementById('image-grid');
  const empty = document.getElementById('empty-state');

  if (state.images.length === 0) {
    grid.style.display = 'none'; grid.innerHTML = '';
    empty.classList.add('visible');
    if (msnry) { msnry.destroy(); msnry = null; }
    _renderingGrid = false;
    return;
  }

  grid.style.display = '';
  empty.classList.remove('visible');

  if (layoutTimer) { _cancelRIC(layoutTimer); layoutTimer = null; }
  if (msnry) { msnry.destroy(); msnry = null; }
  grid.innerHTML = '';
  updateCardWidth();

  const sizer = document.createElement('div');
  sizer.className = 'grid-sizer';
  grid.appendChild(sizer);

  state.images.forEach((image, idx) => grid.appendChild(buildCard(image, idx)));

  msnry = initMasonry(grid, '.image-card');
  requestAnimationFrame(() => {
    if (msnry) msnry.layout();
    _renderingGrid = false;
  });

  syncSelectionUI();
  renderActiveFilters();
}

function appendToGrid(images) {
  const grid = document.getElementById('image-grid');
  if (!msnry || !images.length) return;

  _renderingGrid = true;

  const startIdx = state.images.length - images.length;
  const newCards = images.map((image, i) => buildCard(image, startIdx + i));

  newCards.forEach(card => grid.appendChild(card));
  msnry.appended(newCards);
  requestAnimationFrame(() => {
    if (msnry) msnry.layout();
    _renderingGrid = false;
  });
}

function buildCard(image, idx) {
  const card = document.createElement('div');
  card.className = 'image-card' + (selection.has(image.id) ? ' selected' : '');
  card.dataset.id  = image.id;
  card.dataset.idx = idx;

  const thumb = (image.thumbnail && image.thumbnail !== 'error' && image.thumbnail !== 'placeholder')
    ? `/thumbs/${image.thumbnail}` : null;

  const tagBadges = (image.tags || []).map(name => {
    const t     = state.tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const style = color ? `style="background:${esc(color)}"` : '';
    return `<span class="tag-badge" ${style}>${esc(name)}</span>`;
  }).join('');

  let title = image.page_title;
  if (!title) { try { title = new URL(image.source_url).hostname; } catch (_) { title = ''; } }

  // Use stored dimensions for an exact skeleton height — when the real image loads
  // the card height won't change, so Masonry never needs to re-layout.
  // Fall back to 1.3 aspect ratio for images that predate dimension storage.
  const knownDimensions = image.width && image.height;
  const aspectRatio = knownDimensions ? (image.height / image.width) : 1.3;
  const placeholderHeight = Math.round(currentCardWidth * aspectRatio);

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
      // Always re-layout — skeleton height and rendered img height can differ by
      // a pixel due to rounding, and that drift accumulates across many cards.
      scheduleLayout();
    });
    img.addEventListener('error', () => {
      const sk = card.querySelector('.card-skeleton');
      if (sk) { sk.style.animation = 'none'; sk.style.background = 'var(--surface)'; }
      scheduleLayout();
    });
  }

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

  // Show/hide the clear button based on checked tags
  const clearBtn = document.getElementById('clear-tags-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !(state.checkedTags && state.checkedTags.length > 0));
}

function buildTagItem(tag, isChild) {
  const li = document.createElement('li');
  li.className = 'tag-item' + (isChild ? ' child-tag' : '');

  const isChecked = state.checkedTags?.includes(tag.id);
  const isSingle  = state.activeTags.length === 1 && state.activeTags[0] === tag.id && !isChecked;
  if (isSingle)  li.classList.add('active');
  if (isChecked) li.classList.add('multi-active');
  li.dataset.tagId = tag.id;

  const tagColor = tag.color || getTagColor(tag.name);
  if (tagColor && !isSingle && !isChecked) li.style.background = tagColor;

  li.innerHTML = `
    <input type="checkbox" class="tag-check" ${isChecked ? 'checked' : ''} />
    <span class="tag-name">${esc(tag.name)}</span>
    <span class="tag-count">${tag.count || 0}</span>
    <span class="tag-actions">
      <button class="tag-action-btn delete" title="Delete">✕</button>
    </span>
  `;

  // Checkbox click → multi-select OR filter (append/remove from checkedTags)
  li.querySelector('.tag-check').addEventListener('click', e => {
    e.stopPropagation();
    e.preventDefault();
    if (!state.checkedTags) state.checkedTags = [];
    const wasChecked = state.checkedTags.includes(tag.id);
    if (wasChecked) {
      state.checkedTags = state.checkedTags.filter(id => id !== tag.id);
    } else {
      state.checkedTags = [...state.checkedTags, tag.id];
    }
    // Checked tags become the active filter
    state.activeTags = [...state.checkedTags];
    state.showUntagged = false;
    state.activeCollection = null;
    document.getElementById('all-images-btn').classList.toggle('active', state.activeTags.length === 0);
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    loadImages();
  });

  // Tag row click (not checkbox) → single-tag browse (switch, don't append)
  li.addEventListener('click', e => {
    if (e.target.closest('.tag-actions')) return;
    if (e.target.closest('.tag-check')) return;  // handled above
    // Clear any checked state — single browse replaces everything
    state.checkedTags = [];
    // If clicking the already-active single tag, deselect it
    if (state.activeTags.length === 1 && state.activeTags[0] === tag.id) {
      state.activeTags = [];
    } else {
      state.activeTags = [tag.id];
    }
    state.showUntagged = false;
    state.activeCollection = null;
    document.getElementById('all-images-btn').classList.toggle('active', state.activeTags.length === 0);
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
      <span class="collection-actions">
        <button class="collection-edit" title="Edit">✎</button>
        <button class="collection-delete" title="Delete">✕</button>
      </span>
    `;

    li.querySelector('.collection-name').addEventListener('click', () => {
      state.activeCollection = state.activeCollection === col.id ? null : col.id;
      state.activeTags = [];
      state.checkedTags = [];
      state.showUntagged = false;
      document.getElementById('all-images-btn').classList.toggle('active', !state.activeCollection);
      document.getElementById('untagged-btn').classList.remove('active');
      renderCollections();
      renderTagList();
      loadImages();
    });

    li.querySelector('.collection-edit').addEventListener('click', e => {
      e.stopPropagation();
      openCollectionModal('edit', col);
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
        state.checkedTags = (state.checkedTags || []).filter(id => id !== tagId);
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
  try {
    const { total, untagged } = await apiFetch('/images/counts');
    document.getElementById('all-images-btn').dataset.count = total;
    const savedEl = document.getElementById('saved-count');
    if (savedEl) savedEl.textContent = `${total} saved`;
    document.getElementById('untagged-btn').dataset.count = untagged;
  } catch (_) {}
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
  const tags = getDetailTags();
  try {
    await apiFetch(`/images/${imageId}`, { method: 'PATCH', body: JSON.stringify({ tags }) });
    const img = state.images.find(i => i.id === imageId);
    if (img) img.tags = tags;
    patchCardBadges(imageId, tags);
    await loadTags();

    // If a filter is active and this image no longer matches it, sweep it out
    if (!imageMatchesCurrentFilter(tags)) {
      const scrollEl = document.getElementById('grid-scroll');
      const savedScroll = scrollEl.scrollTop;
      closeDetail();
      const card = document.querySelector(`.image-card[data-id="${imageId}"]`);
      if (card && msnry) {
        _renderingGrid = true;
        await sweep(card, 0).finished;
        msnry.remove(card);
        requestAnimationFrame(() => {
          if (msnry) msnry.layout();
          scrollEl.scrollTop = savedScroll;
          _renderingGrid = false;
        });
      }
      state.images = state.images.filter(i => i.id !== imageId);
      state.totalImages = Math.max(0, state.totalImages - 1);
      updateCounts();
    }
  } catch (err) {
    toast('Failed to save tags');
  }
}

// Returns true if a set of tag names still satisfies the current sidebar filter.
// Used after editing tags in the detail panel to decide if the card stays visible.
function imageMatchesCurrentFilter(tagNames) {
  // No filter — always visible
  if (!state.showUntagged && !state.activeCollection && state.activeTags.length === 0 && !state.searchQuery) {
    return true;
  }
  // Untagged filter
  if (state.showUntagged) return tagNames.length === 0;
  // Collection / search — can't evaluate client-side, leave card in place
  if (state.activeCollection || state.searchQuery) return true;
  // Tag filter (single-tag browse or checkbox OR)
  if (state.activeTags.length > 0) {
    const activeNames = new Set(
      state.activeTags.flatMap(id => {
        const t = state.tags.find(t => t.id === id);
        if (!t) return [];
        // Include the tag itself and any of its children
        const children = state.tags.filter(c => c.parent_id === id).map(c => c.name);
        return [t.name, ...children];
      })
    );
    return tagNames.some(name => activeNames.has(name));
  }
  return true;
}

function patchCardBadges(imageId, tags) {
  const card = document.querySelector(`.image-card[data-id="${imageId}"]`);
  if (!card) return;
  const badgeHtml = tags.map(name => {
    const t     = state.tags.find(t => t.name === name);
    const color = t?.color || getTagColor(name);
    const style = color ? `style="background:${esc(color)}"` : '';
    return `<span class="tag-badge" ${style}>${esc(name)}</span>`;
  }).join('');
  let badgesEl = card.querySelector('.card-badges');
  if (badgesEl) {
    badgesEl.innerHTML = badgeHtml;
  } else if (badgeHtml) {
    badgesEl = document.createElement('div');
    badgesEl.className = 'card-badges';
    badgesEl.innerHTML = badgeHtml;
    card.querySelector('.card-meta')?.appendChild(badgesEl);
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

  const commitDetailTag = (name) => {
    if (!name || getDetailTags().includes(name)) return;
    addDetailTagPill(name, image.id);
    saveDetailTags(image.id);
  };

  _detailSuggest?.destroy();
  _detailSuggest = attachTagSuggestions(addInput, () => state.tags, (name) => {
    commitDetailTag(name);
  });

  addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = addInput.value.trim();
      if (!val) return;
      commitDetailTag(val);
      addInput.value = '';
    }
    if (e.key === 'Escape') addInput.blur();
  });

  document.getElementById('detail-open-source').addEventListener('click', () => window.open(image.source_url, '_blank', 'noopener'));

  document.getElementById('detail-delete').addEventListener('click', async () => {
    if (!confirm('Delete this Got? This cannot be undone.')) return;
    const scrollEl = document.getElementById('grid-scroll');
    const savedScroll = scrollEl.scrollTop;
    try {
      await apiFetch(`/images/${image.id}`, { method: 'DELETE' });
      closeDetail();
      const card = document.querySelector(`.image-card[data-id="${image.id}"]`);
      if (card && msnry) {
        _renderingGrid = true;
        await sweep(card, 0).finished;
        msnry.remove(card);
        requestAnimationFrame(() => {
          if (msnry) msnry.layout();
          scrollEl.scrollTop = savedScroll;
          _renderingGrid = false;
        });
      }
      state.images = state.images.filter(i => i.id !== image.id);
      state.totalImages = Math.max(0, state.totalImages - 1);
      updateCounts();
      await loadTags();
    } catch (err) { alert(`Failed to delete: ${err.message}`); }
  });
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-overlay').classList.remove('open');
  state.detailImageId = null;
  _detailSuggest?.destroy(); _detailSuggest = null;
}

// ── Tag management (inline) ────────────────────────────────────────
async function confirmDeleteTag(tag) {
  if (!confirm(`Delete tag "${tag.name}"? It will be removed from all Gots.`)) return;
  try {
    await apiFetch(`/tags/${tag.id}`, { method: 'DELETE' });
    state.activeTags = state.activeTags.filter(id => id !== tag.id);
    state.checkedTags = (state.checkedTags || []).filter(id => id !== tag.id);
    await Promise.all([loadImages(), loadTags()]);
  } catch (err) { alert(`Failed to delete tag: ${err.message}`); }
}

async function createTag(name) {
  try {
    await apiFetch('/tags', { method: 'POST', body: JSON.stringify({ name }) });
    await loadTags();
  } catch (err) { alert(`Failed to create tag: ${err.message}`); }
}

// ── Collection modal ───────────────────────────────────────────────
function _createCollectionModal() {
  const modal = document.createElement('div');
  modal.id = 'collection-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div id="collection-modal-backdrop"></div>
    <div id="collection-modal-dialog" role="dialog" aria-modal="true">
      <h3 id="collection-modal-title">New Collection</h3>
      <div class="collection-form-row">
        <input type="text" id="collection-name-input" placeholder="Collection name" maxlength="100" />
      </div>
      <div class="collection-form-row">
        <label>Filter tags (AND — images must have all selected tags):</label>
        <div class="detail-tags-wrap" id="collection-selected-tags"></div>
        <div style="margin-top:6px">
          <input type="text" class="detail-add-tag-input" id="collection-tag-input" placeholder="+ add tag" autocomplete="off" />
        </div>
      </div>
      <p id="collection-match-count" class="collection-match-count"></p>
      <div id="collection-modal-actions">
        <button id="collection-modal-cancel" class="btn">Cancel</button>
        <button id="collection-modal-save" class="btn btn-primary" disabled>Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#collection-modal-backdrop').addEventListener('click', closeCollectionModal);
  modal.querySelector('#collection-modal-cancel').addEventListener('click', closeCollectionModal);
  modal.querySelector('#collection-modal-save').addEventListener('click', saveCollection);
  modal.querySelector('#collection-name-input').addEventListener('input', updateCollectionSaveBtn);
  modal.querySelector('#collection-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !getCollectionTagNames().includes(val)) {
        addCollectionTagPill(val);
        updateCollectionSaveBtn();
        updateCollectionMatchCount();
      }
      e.target.value = '';
    }
    if (e.key === 'Escape') closeCollectionModal();
  });
  modal.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCollectionModal();
  });

  return modal;
}

function openCollectionModal(mode, col = null) {
  _editingCollectionId = mode === 'edit' ? col.id : null;

  if (!_collectionModal) _collectionModal = _createCollectionModal();

  const isEdit = mode === 'edit';
  _collectionModal.querySelector('#collection-modal-title').textContent = isEdit ? 'Edit Collection' : 'New Collection';
  const saveBtn = _collectionModal.querySelector('#collection-modal-save');
  saveBtn.textContent = isEdit ? 'Save' : 'Create';

  const nameInput = _collectionModal.querySelector('#collection-name-input');
  nameInput.value = isEdit ? col.name : '';

  const selectedTags = _collectionModal.querySelector('#collection-selected-tags');
  selectedTags.innerHTML = '';
  if (isEdit) {
    const tq = col.tag_query || { tags: [] };
    (tq.tags || []).forEach(name => addCollectionTagPill(name));
  }

  _collectionSuggest?.destroy();
  const tagInput = _collectionModal.querySelector('#collection-tag-input');
  tagInput.value = '';
  _collectionSuggest = attachTagSuggestions(tagInput, () => state.tags, name => {
    if (getCollectionTagNames().includes(name)) return;
    addCollectionTagPill(name);
    tagInput.value = '';
    updateCollectionSaveBtn();
    updateCollectionMatchCount();
  });

  _collectionModal.hidden = false;
  updateCollectionSaveBtn();
  updateCollectionMatchCount();
  setTimeout(() => nameInput.focus(), 50);
}

function closeCollectionModal() {
  if (_collectionModal) _collectionModal.hidden = true;
  _collectionSuggest?.destroy();
  _collectionSuggest = null;
  _editingCollectionId = null;
}

function addCollectionTagPill(name) {
  const wrap = _collectionModal.querySelector('#collection-selected-tags');
  const t = state.tags.find(t => t.name === name);
  const color = t?.color || getTagColor(name);
  const pill = document.createElement('span');
  pill.className = 'detail-tag-pill';
  pill.dataset.tag = name;
  pill.style.background = color;
  pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
  pill.querySelector('.detail-tag-remove').addEventListener('click', () => {
    pill.remove();
    updateCollectionSaveBtn();
    updateCollectionMatchCount();
  });
  wrap.appendChild(pill);
}

function getCollectionTagNames() {
  if (!_collectionModal) return [];
  return [..._collectionModal.querySelectorAll('#collection-selected-tags .detail-tag-pill')].map(p => p.dataset.tag);
}

function updateCollectionSaveBtn() {
  const name = _collectionModal?.querySelector('#collection-name-input')?.value.trim();
  const tags = getCollectionTagNames();
  const btn = _collectionModal?.querySelector('#collection-modal-save');
  if (btn) btn.disabled = !name || tags.length === 0;
}

async function updateCollectionMatchCount() {
  const names = getCollectionTagNames();
  const el = _collectionModal?.querySelector('#collection-match-count');
  if (!el) return;
  if (names.length === 0) { el.textContent = ''; return; }
  try {
    const images = await apiFetch('/images?tags_and=' + encodeURIComponent(names.join(',')));
    const count = Array.isArray(images) ? images.length : 0;
    el.textContent = `${count} Got${count !== 1 ? 's' : ''} match this filter`;
  } catch (_) { el.textContent = ''; }
}

async function saveCollection() {
  const name = _collectionModal.querySelector('#collection-name-input').value.trim();
  const tags = getCollectionTagNames();
  if (!name || tags.length === 0) return;

  try {
    if (_editingCollectionId) {
      await apiFetch(`/smart-collections/${_editingCollectionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, tag_query: { operator: 'AND', tags } })
      });
      if (state.activeCollection === _editingCollectionId) await loadImages();
    } else {
      await apiFetch('/smart-collections', {
        method: 'POST',
        body: JSON.stringify({ name, tag_query: { operator: 'AND', tags } })
      });
    }
    closeCollectionModal();
    await loadCollections();
  } catch (err) { alert(`Failed to save collection: ${err.message}`); }
}

// ── Bulk action handler ────────────────────────────────────────────
async function handleBulkAction({ action, ids, tags = [], add = [], remove = [] }) {
  try {
    await apiFetch('/gots/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, tags, add, remove })
    });

    if (action === 'delete') {
      const cards = [...document.querySelectorAll('.image-card')]
        .filter(c => ids.includes(c.dataset.id));
      await Promise.all(cards.map((c, i) => sweep(c, i * 40).finished));
      selection.clear();
      toast(`Deleted ${ids.length} Gots`);
      await Promise.all([loadImages(), loadTags()]);
    } else {
      // Tag operations — patch only the affected cards, no grid rebuild
      const patchParams = new URLSearchParams(buildImageQuery());
      patchParams.set('limit', Math.max(state.images.length, 200));
      patchParams.set('offset', 0);
      const { images: fresh } = await apiFetch('/images?' + patchParams.toString());
      for (const id of ids) {
        const img = fresh.find(i => i.id === id);
        if (img) patchCardBadges(id, img.tags);
      }
      selection.clear();
      toast(`Updated ${ids.length} Gots`);
      await loadTags();
    }
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

    // Patch only affected cards — no grid rebuild
    const dropParams = new URLSearchParams(buildImageQuery());
    dropParams.set('limit', Math.max(state.images.length, 200));
    dropParams.set('offset', 0);
    const { images: fresh } = await apiFetch('/images?' + dropParams.toString());
    for (const id of imageIds) {
      const img = fresh.find(i => i.id === id);
      if (img) patchCardBadges(id, img.tags);
    }

    toast(`${imageIds.length} Got${imageIds.length > 1 ? 's' : ''} tagged → ${tagName}`);
    selection.clear();
    await loadTags();
  } catch (err) { alert(`Tag drop failed: ${err.message}`); }
}

// ── Module instances ───────────────────────────────────────────────
const selection = new SelectionManager();
const bulkBar   = new BulkActionBar({
  selection,
  onAction:    handleBulkAction,
  getTags:     () => state.images,  // images carry .tags[], used by manage_tags prompt
  getTagDefs:  () => state.tags,    // tag definitions with .color, used for autocomplete
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

  const addGotTagInput = document.getElementById('add-got-tag-input');
  _addGotSuggest?.destroy();
  _addGotSuggest = attachTagSuggestions(addGotTagInput, () => state.tags, (name) => {
    addModalPill(name);
  });

  addGotTagInput.addEventListener('keydown', e => {
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
          body: JSON.stringify({ source_url, page_title, page_url, tags }),
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
  _addGotSuggest?.destroy(); _addGotSuggest = null;
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
    state.checkedTags = [];
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
    state.checkedTags = [];
    state.activeCollection = null;
    document.getElementById('untagged-btn').classList.toggle('active', state.showUntagged);
    document.getElementById('all-images-btn').classList.toggle('active', !state.showUntagged);
    renderTagList();
    renderCollections();
    loadImages();
  });

  document.getElementById('clear-tags-btn').addEventListener('click', () => {
    state.activeTags = [];
    state.checkedTags = [];
    state.activeCollection = null;
    state.showUntagged = false;
    document.getElementById('all-images-btn').classList.add('active');
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    loadImages();
  });

  document.getElementById('grid-scroll').addEventListener('scroll', debounce(() => {
    if (_renderingGrid) return;
    if (state.loading) return;
    if (state.images.length >= state.totalImages) return;
    const el = document.getElementById('grid-scroll');
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
      loadImages(true);
    }
  }, 100));

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
    openCollectionModal('create');
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
