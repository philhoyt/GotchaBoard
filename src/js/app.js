import '@fontsource/syne/700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '../styles/main.scss';

import { toggleTheme }    from './utils/theme.js';
import { calcColumnWidth, DEFAULT_CARD_WIDTH, initMasonry } from './utils/grid.js';
import { buildCard as _buildCard } from './components/card.js';
import { sweep }          from './animations.js';
import { SelectionManager } from './multiselect.js';
import { DragStack }      from './dragStack.js';
import { BulkActionBar }  from './bulkActions.js';
import { initImportModal } from './importModal.js';

import { stateManager, state } from './stateManager.js';
import { API, apiFetch } from './api.js';
import { debounce } from './utils/helpers.js';
import { toast } from './utils/toast.js';

import { initSidebar, renderTagList, renderCollections, renderActiveFilters, createTag } from './sidebar.js';
import { initDetailPanel, openDetail, closeDetail } from './detailPanel.js';
import { openCollectionModal } from './collectionModal.js';
import { openAddGotModal, closeAddGotModal } from './addGotModal.js';
import { initSettingsPanel, closeSettings } from './settingsPanel.js';

'use strict';

// ── Grid state ─────────────────────────────────────────────────────
let msnry            = null;
let currentCardWidth = DEFAULT_CARD_WIDTH;
let layoutTimer      = null;
let _renderingGrid   = false;
let _justDragged     = false;

const _schedRIC  = window.requestIdleCallback
  ? (fn) => requestIdleCallback(fn, { timeout: 500 })
  : (fn) => setTimeout(fn, 100);
const _cancelRIC = window.cancelIdleCallback || clearTimeout;

// ── Sweep helper ───────────────────────────────────────────────────
// Used by detailPanel and handleBulkAction via callbacks.
async function sweepCards(ids, { stagger = false } = {}) {
  const scrollEl   = document.getElementById('grid-scroll');
  const savedScroll = scrollEl.scrollTop;
  const cards = [...document.querySelectorAll('.image-card')]
    .filter(c => ids.includes(c.dataset.id));
  if (!cards.length) return;
  await Promise.all(cards.map((c, i) => sweep(c, stagger ? i * 40 : 0).finished));
  if (msnry) {
    _renderingGrid = true;
    cards.forEach(card => msnry.remove(card));
    requestAnimationFrame(() => {
      if (msnry) msnry.layout();
      scrollEl.scrollTop = savedScroll;
      _renderingGrid = false;
    });
  }
}

// ── Grid rendering ─────────────────────────────────────────────────
function scheduleLayout() {
  if (layoutTimer) return;
  layoutTimer = _schedRIC(() => {
    layoutTimer = null;
    if (msnry) msnry.layout();
  });
}

function updateCardWidth() {
  const scroll = document.getElementById('grid-scroll');
  const innerWidth = scroll.clientWidth - 24;
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
    fillViewportIfNeeded();
  });

  syncSelectionUI();
  renderActiveFilters();
}

function fillViewportIfNeeded() {
  const el = document.getElementById('grid-scroll');
  if (!el || state.loading || state.images.length >= state.totalImages) return;
  if (el.scrollHeight - el.clientHeight < el.clientHeight) {
    stateManager.loadImages(true);
  }
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
    fillViewportIfNeeded();
  });
}

function buildCard(image, idx) {
  return _buildCard(image, idx, {
    isSelected:     selection.has(image.id),
    cardWidth:      currentCardWidth,
    tags:           state.tags,
    scheduleLayout,
    onSelectZone: (e, imageId, i) => {
      if (e.shiftKey && selection.lastIndex !== null) {
        selection.rangeSelect(state.images.map(img => img.id), selection.lastIndex, i);
      } else {
        selection.toggle(imageId, i);
      }
      syncSelectionUI();
    },
    onOpen: (imageId) => {
      if (_justDragged) return;
      openDetail(imageId);
    },
    onMouseDown: (e, card) => {
      if (selection.has(image.id)) {
        e.preventDefault();
        dragStack.prime(e, card, document.querySelectorAll('.image-card'));
      }
    },
  });
}

function syncSelectionUI() {
  const hasAny = selection.size > 0;
  document.getElementById('app').classList.toggle('any-selected', hasAny);
  document.querySelectorAll('.image-card').forEach(card => {
    card.classList.toggle('selected', selection.has(card.dataset.id));
  });
}

// ── Bulk action handler ────────────────────────────────────────────
async function handleBulkAction({ action, ids, tags = [], add = [], remove = [] }) {
  try {
    await apiFetch('/gots/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, action, tags, add, remove })
    });

    if (action === 'delete') {
      await sweepCards(ids, { stagger: true });
      const deletedIds = new Set(ids);
      state.images      = state.images.filter(i => !deletedIds.has(i.id));
      state.totalImages = Math.max(0, state.totalImages - ids.length);
      selection.clear();
      toast(`Deleted ${ids.length} Gots`);
      stateManager.updateCounts();
      await stateManager.loadTags();
    } else {
      await stateManager.onTagsChanged(ids, {
        onRemove: (removedIds) => sweepCards(removedIds, { stagger: true })
      });
      selection.clear();
      toast(`Updated ${ids.length} Gots`);
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
    await stateManager.onTagsChanged(imageIds);
    toast(`${imageIds.length} Got${imageIds.length > 1 ? 's' : ''} tagged → ${tagName}`);
    selection.clear();
  } catch (err) { alert(`Tag drop failed: ${err.message}`); }
}

// ── Module instances ───────────────────────────────────────────────
const selection = new SelectionManager();
const dragStack = new DragStack({
  selection,
  onDrop:         handleDrop,
  getDropTargets: () => document.querySelectorAll('[data-tag-id]'),
  onDragEnd:      () => { _justDragged = true; setTimeout(() => { _justDragged = false; }, 0); }
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
  fillViewportIfNeeded();
}

// ── Board-level file drop upload ───────────────────────────────────
async function uploadDroppedFiles(files) {
  const total = files.length;
  let done = 0;
  let failed = 0;

  const progressToast = toast(`Uploading 0 / ${total}…`, 0);
  const updateProgress = () => {
    const msgEl = progressToast.querySelector('.toast-message');
    if (msgEl) msgEl.textContent = `Uploading ${done} / ${total}…`;
  };

  const queue = [...files];
  const CONCURRENCY = 3;

  const processNext = async () => {
    while (queue.length > 0) {
      const file = queue.shift();
      try {
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${API}/images/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const saved = await res.json();
        done++;
        updateProgress();

        const unfiltered = !state.showUntagged && !state.activeCollection &&
                           state.activeTags.length === 0 &&
                           state.checkedTags.length === 0 && !state.searchQuery;
        if (unfiltered) {
          state.images.unshift(saved);
          state.totalImages++;
          const grid = document.getElementById('image-grid');
          if (msnry && grid) {
            const card = buildCard(saved, 0);
            grid.insertBefore(card, grid.firstChild);
            msnry.prepended(card);
            requestAnimationFrame(() => { if (msnry) msnry.layout(); });
          }
        }
      } catch (err) {
        failed++;
        done++;
        updateProgress();
        console.error(`Upload failed for ${file.name}:`, err);
      }
    }
  };

  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, processNext);
  await Promise.all(workers);

  progressToast.classList.add('out');
  progressToast.addEventListener('animationend', () => progressToast.remove());

  const succeeded = done - failed;
  if (failed > 0) {
    toast(`Uploaded ${succeeded} / ${total} Got${total > 1 ? 's' : ''}. ${failed} failed.`);
  } else {
    toast(`${total} Got${total > 1 ? 's' : ''} uploaded!`);
  }

  stateManager.updateCounts();
  await stateManager.loadTags();
}

// ── Event listeners ────────────────────────────────────────────────
function bindEventListeners() {
  document.getElementById('all-images-btn').addEventListener('click', () => {
    state.activeTags       = [];
    state.checkedTags      = [];
    state.activeCollection = null;
    state.showUntagged     = false;
    document.getElementById('all-images-btn').classList.add('active');
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    stateManager.loadImages();
  });

  document.getElementById('untagged-btn').addEventListener('click', () => {
    state.showUntagged     = !state.showUntagged;
    state.activeTags       = [];
    state.checkedTags      = [];
    state.activeCollection = null;
    document.getElementById('untagged-btn').classList.toggle('active', state.showUntagged);
    document.getElementById('all-images-btn').classList.toggle('active', !state.showUntagged);
    renderTagList();
    renderCollections();
    stateManager.loadImages();
  });

  document.getElementById('clear-tags-btn').addEventListener('click', () => {
    state.activeTags       = [];
    state.checkedTags      = [];
    state.activeCollection = null;
    state.showUntagged     = false;
    document.getElementById('all-images-btn').classList.add('active');
    document.getElementById('untagged-btn').classList.remove('active');
    renderTagList();
    renderCollections();
    stateManager.loadImages();
  });

  document.getElementById('grid-scroll').addEventListener('scroll', debounce(() => {
    if (_renderingGrid) return;
    if (state.loading) return;
    if (state.images.length >= state.totalImages) return;
    const el = document.getElementById('grid-scroll');
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
      stateManager.loadImages(true);
    }
  }, 100));

  document.getElementById('search-input').addEventListener('input', debounce(e => {
    state.searchQuery = e.target.value.trim();
    stateManager.loadImages();
  }, 300));

  document.getElementById('sort-select').addEventListener('change', e => {
    state.sortOrder = e.target.value;
    stateManager.loadImages();
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

  // Collection edit button dispatched from sidebar.js to avoid import coupling
  document.addEventListener('open-collection-modal', e => {
    openCollectionModal(e.detail.mode, e.detail.col);
  });

  document.querySelectorAll('.grid-scale-btn').forEach(btn => {
    btn.addEventListener('click', () => setCardWidth(Number(btn.dataset.cardWidth)));
  });

  document.getElementById('add-got-btn').addEventListener('click', openAddGotModal);

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', closeDetail);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('settings-panel').style.display !== 'none') { closeSettings(); return; }
    if (e.key === 'Escape' && document.getElementById('add-got-modal').style.display !== 'none') { closeAddGotModal(); return; }
    if (e.key === 'Escape' && state.detailImageId) { closeDetail(); return; }
    if (e.key === 'Escape') selection.clear();
  });

  // ── Board-level file drop ────────────────────────────────────────
  {
    const main    = document.getElementById('main');
    const overlay = document.getElementById('board-drop-overlay');
    let dragCounter = 0;

    const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');

    main.addEventListener('dragenter', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragCounter++;
      if (dragCounter === 1) overlay.classList.remove('hidden');
    });

    main.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; overlay.classList.add('hidden'); }
    });

    main.addEventListener('dragover', e => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    main.addEventListener('drop', e => {
      e.preventDefault();
      dragCounter = 0;
      overlay.classList.add('hidden');
      const files = [...e.dataTransfer.files].filter(f =>
        f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i.test(f.name)
      );
      if (files.length) uploadDroppedFiles(files);
    });

    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop',     e => e.preventDefault());
  }
}

// ── BulkActionBar (needs handleBulkAction defined above) ───────────
const bulkBar = new BulkActionBar({
  selection,
  onAction:   handleBulkAction,
  getTags:    () => state.images,
  getTagDefs: () => state.tags,
});

// suppress unused-var lint warning — bulkBar registers itself on the DOM
void bulkBar;

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wire event-driven rendering
  stateManager.on('images-loaded',   renderGrid);
  stateManager.on('images-appended', appendToGrid);

  // Init modules
  initSidebar();
  initDetailPanel({ sweepCards });
  initSettingsPanel();
  initImportModal({ onDone: () => stateManager.loadAll() });

  const savedCardWidth = localStorage.getItem('gotcha-card-width');
  if (savedCardWidth) {
    document.querySelectorAll('.grid-scale-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.cardWidth) === Number(savedCardWidth));
    });
  }

  bindEventListeners();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      updateCardWidth();
      if (msnry) msnry.layout();
      fillViewportIfNeeded();
    }, 150);
  });

  window.electronAPI?.onUpdateAvailable(({ version, url }) => {
    if (localStorage.getItem('update-dismissed') === version) return;
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.innerHTML =
      `<span>GotchaBoard v${version} is available</span>` +
      `<a href="${url}" target="_blank" rel="noopener noreferrer">Download</a>` +
      `<button class="update-banner-dismiss" aria-label="Dismiss">✕</button>`;
    banner.querySelector('.update-banner-dismiss').addEventListener('click', () => {
      localStorage.setItem('update-dismissed', version);
      banner.remove();
    });
    document.body.appendChild(banner);
  });

  // ── New-got detection on window focus / tab visibility ────────────
  function isUnfiltered() {
    return !state.activeTags.length && !state.activeCollection &&
           !state.showUntagged && !state.searchQuery &&
           state.sortOrder === 'saved_at_desc';
  }

  async function checkForNewGots() {
    if (state.loading || _renderingGrid) return;
    try {
      const { total } = await apiFetch('/images/counts');
      const newCount = total - state.totalImages;
      if (newCount <= 0) return;

      const scrollEl = document.getElementById('grid-scroll');
      if (isUnfiltered() && scrollEl.scrollTop === 0) {
        stateManager.loadImages();
      } else {
        showNewGotsNudge(newCount);
      }
    } catch { /* best-effort */ }
  }

  function showNewGotsNudge(count) {
    document.getElementById('new-gots-nudge')?.remove();
    const nudge = document.createElement('button');
    nudge.id = 'new-gots-nudge';
    nudge.textContent = `↑ ${count} new got${count !== 1 ? 's' : ''} — click to refresh`;
    nudge.addEventListener('click', () => { nudge.remove(); stateManager.loadImages(); });
    document.getElementById('grid-scroll').prepend(nudge);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewGots();
  });
  window.addEventListener('focus', checkForNewGots);

  stateManager.loadAll().catch(() => {
    document.getElementById('image-grid').innerHTML = `
      <div style="padding:40px;text-align:center;color:#dc2626">
        <p>Could not connect to GotchaBoard server.</p>
        <p style="font-size:12px;margin-top:8px;color:#6b7280">Run <code>npm start</code> in the project directory.</p>
      </div>
    `;
    document.getElementById('image-grid').style.display = '';
  });
});
