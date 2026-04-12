'use strict';

const API = window.location.origin + '/api';

// ── Utilities ──────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, duration = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ── State ──────────────────────────────────────────────────────────
let allTags = [];
let feedOffset    = 0;
let feedSeed      = 0;
let feedCardCount = 0;  // tracks round-robin position across Load More calls
const PAGE_SIZE = 50;

// ── Column helpers ─────────────────────────────────────────────────
function getDiscoverCols() {
  const preferred = Number(localStorage.getItem('gotcha-discover-cols')) || 4;
  const w = window.innerWidth;
  if (w <= 600) return Math.min(preferred, 2);
  if (w <= 900) return Math.min(preferred, 3);
  return preferred;
}

function initGridCols() {
  const grid = document.getElementById('discover-grid');
  grid.innerHTML = '';
  feedCardCount = 0;
  const n = getDiscoverCols();
  for (let i = 0; i < n; i++) {
    const col = document.createElement('div');
    col.className = 'discover-grid-col';
    grid.appendChild(col);
  }
}

function appendCards(candidates) {
  const cols = document.querySelectorAll('.discover-grid-col');
  if (!cols.length) return;
  for (const c of candidates) {
    cols[feedCardCount % cols.length].appendChild(buildCard(c));
    feedCardCount++;
  }
}

// ── Grid scale ─────────────────────────────────────────────────────
function setGridCols(n) {
  document.querySelectorAll('.grid-scale-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.cols) === n);
  });
  localStorage.setItem('gotcha-discover-cols', n);
}

// ── Render a candidate card ────────────────────────────────────────
function buildCard(candidate) {
  const card = document.createElement('div');
  card.className = 'discover-card';
  card.dataset.id = candidate.id;

  const sourceDomain = (() => {
    try { return new URL(candidate.page_url || candidate.image_url).hostname.replace('www.', ''); }
    catch (_) { return candidate.source_type; }
  })();

  card.innerHTML = `
    <img class="discover-card-img" src="${esc(candidate.image_url)}"
         alt="" loading="lazy">
    <div class="discover-card-meta">
      <div class="discover-card-top">
        <span class="discover-source" title="${esc(candidate.page_url || '')}">${esc(sourceDomain)}</span>
      </div>
      <div class="discover-card-actions">
        <button class="discover-save-btn" data-id="${candidate.id}">Save Got</button>
        <button class="discover-dismiss-btn" data-id="${candidate.id}" title="Dismiss">✕</button>
      </div>
    </div>
  `;

  const img = card.querySelector('.discover-card-img');
  img.addEventListener('load', () => {
    if (img.naturalWidth < 500 || img.naturalHeight < 500) {
      dismissCandidate(candidate.id, card);
    }
  });
  img.addEventListener('error', () => dismissCandidate(candidate.id, card));
  img.addEventListener('click', () => saveCandidate(candidate));
  card.querySelector('.discover-save-btn').addEventListener('click', () => saveCandidate(candidate));
  card.querySelector('.discover-dismiss-btn').addEventListener('click', () => dismissCandidate(candidate.id, card));

  return card;
}

// ── Load feed ──────────────────────────────────────────────────────
async function loadFeed() {
  feedOffset = 0;
  feedSeed   = Math.floor(Math.random() * 2147483647);
  showState('loading');
  try {
    const data = await apiFetch(`/discover?limit=${PAGE_SIZE}&offset=0&seed=${feedSeed}`);

    if (data.candidates.length === 0) {
      showState('empty');
      updateLoadMore(0, 0);
      return;
    }

    showState('grid');
    initGridCols();
    appendCards(data.candidates);
    feedOffset = data.candidates.length;
    updateLoadMore(feedOffset, data.total);
  } catch (err) {
    showState('empty');
    console.error('[discover] load failed:', err);
  }
}

async function loadMore() {
  const btn = document.getElementById('load-more-btn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const data = await apiFetch(`/discover?limit=${PAGE_SIZE}&offset=${feedOffset}&seed=${feedSeed}`);
    appendCards(data.candidates);
    feedOffset += data.candidates.length;
    updateLoadMore(feedOffset, data.total);
  } catch (err) {
    toast('Failed to load more');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load more';
  }
}

function updateLoadMore(loaded, total) {
  const wrap = document.getElementById('load-more-wrap');
  const btn  = document.getElementById('load-more-btn');
  if (!wrap) return;
  const remaining = total - loaded;
  if (remaining > 0) {
    wrap.style.display = '';
    btn.textContent = `Load more (${remaining.toLocaleString()} remaining)`;
  } else {
    wrap.style.display = 'none';
  }
}

function showState(state) {
  document.getElementById('discover-grid').style.display    = state === 'grid'    ? '' : 'none';
  document.getElementById('discover-empty').style.display   = state === 'empty'   ? 'flex' : 'none';
  document.getElementById('discover-loading').style.display = state === 'loading' ? 'flex' : 'none';
}

// ── Save candidate ─────────────────────────────────────────────────
async function saveCandidate(candidate) {
  // Open detail-panel-style form to add tags before saving
  openSaveDialog(candidate);
}

function openSaveDialog(candidate) {
  const panel   = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  const content = document.getElementById('detail-content');

  const getDialogTags = () =>
    [...document.querySelectorAll('#save-dialog-tags-wrap .detail-tag-pill')].map(el => el.dataset.tag);

  const addPill = (name) => {
    const wrap  = document.getElementById('save-dialog-tags-wrap');
    const input = document.getElementById('save-dialog-tag-input');
    if (getDialogTags().includes(name)) return;
    const t     = allTags.find(t => t.name === name);
    const color = t?.color || (typeof getTagColor === 'function' ? getTagColor(name) : '');
    const pill  = document.createElement('span');
    pill.className   = 'detail-tag-pill';
    pill.dataset.tag = name;
    if (color) pill.style.background = color;
    pill.innerHTML = `${esc(name)}<button class="detail-tag-remove" title="Remove">&times;</button>`;
    pill.querySelector('.detail-tag-remove').addEventListener('click', () => pill.remove());
    wrap.insertBefore(pill, input);
  };

  content.innerHTML = `
    <div class="detail-image-wrap">
      <img src="${esc(candidate.image_url)}" alt="">
    </div>
    <div class="detail-field">
      <div class="detail-label">Source</div>
      <div class="detail-value"><a href="${esc(candidate.page_url || candidate.image_url)}"
        target="_blank" rel="noopener">${esc(candidate.page_url || candidate.image_url)}</a></div>
    </div>
    <div class="detail-field">
      <div class="detail-label">Tags</div>
      <div class="detail-tags-wrap" id="save-dialog-tags-wrap">
        <input type="text" class="detail-add-tag-input" id="save-dialog-tag-input" placeholder="+ add tag">
      </div>
    </div>
    <div id="save-dialog-error" style="color:var(--color-coral);font-size:12px;min-height:1em;margin-bottom:8px;"></div>
    <div class="detail-actions">
      <button class="primary-btn" id="save-dialog-confirm">Save Got</button>
      <button class="ghost-btn"   id="save-dialog-cancel">Cancel</button>
    </div>
  `;

  panel.classList.add('open');
  overlay.classList.add('open');

  document.getElementById('save-dialog-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) { addPill(v); e.target.value = ''; } }
    if (e.key === 'Escape') closeSaveDialog();
  });

  document.getElementById('save-dialog-confirm').addEventListener('click', async () => {
    const btn   = document.getElementById('save-dialog-confirm');
    const tags = getDialogTags();

    btn.disabled   = true;
    btn.textContent = 'Saving…';

    try {
      await apiFetch(`/discover/${candidate.id}/save`, {
        method: 'POST',
        body: JSON.stringify({ tags }),
      });
      closeSaveDialog();
      // Remove card from feed
      const card = document.querySelector(`.discover-card[data-id="${candidate.id}"]`);
      if (card) { card.classList.add('dismissing'); card.addEventListener('animationend', () => card.remove()); }
      toast('Got saved!');
    } catch (err) {
      document.getElementById('save-dialog-error').textContent = err.message;
      btn.disabled   = false;
      btn.textContent = 'Save Got';
    }
  });

  document.getElementById('save-dialog-cancel').addEventListener('click', closeSaveDialog);
}

function closeSaveDialog() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-overlay').classList.remove('open');
  document.getElementById('detail-content').innerHTML = '';
}

// ── Dismiss candidate ──────────────────────────────────────────────
async function dismissCandidate(id, card) {
  try {
    await apiFetch(`/discover/${id}/dismiss`, { method: 'POST' });
    card.classList.add('dismissing');
    card.addEventListener('animationend', () => {
      card.remove();
      if (document.getElementById('discover-grid').children.length === 0) showState('empty');
    });
  } catch (err) {
    toast('Failed to dismiss');
  }
}

// ── Sources ────────────────────────────────────────────────────────
async function loadSources() {
  try {
    const sources = await apiFetch('/discover/sources');
    renderSources(sources);
  } catch (_) {}
}

function renderSources(sources) {
  const list = document.getElementById('sources-list');
  if (sources.length === 0) {
    list.innerHTML = '<p class="settings-hint">No sources added yet.</p>';
    return;
  }
  list.innerHTML = sources.map(s => `
    <div class="source-row" data-id="${s.id}">
      <div class="source-row-info">
        <div class="source-row-label">${esc(s.label)}</div>
        <div class="source-row-url">${esc(s.url)}</div>
      </div>
      <span class="source-row-type">${esc(s.type)}</span>
      <button class="source-delete-btn" data-id="${s.id}" title="Remove source">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('.source-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/discover/sources/${btn.dataset.id}`, { method: 'DELETE' });
        await loadSources();
        toast('Source removed');
      } catch (err) {
        toast(`Failed: ${err.message}`);
      }
    });
  });
}

async function addSource() {
  const label    = document.getElementById('source-label').value.trim();
  const url      = document.getElementById('source-url').value.trim();
  const type     = document.getElementById('source-type').value;
  const interval = parseInt(document.getElementById('source-interval').value) || 24;
  const errEl    = document.getElementById('add-source-error');

  errEl.textContent = '';
  if (!label || !url) { errEl.textContent = 'Label and URL are required.'; return; }

  try {
    await apiFetch('/discover/sources', {
      method: 'POST',
      body: JSON.stringify({ label, url, type, fetch_interval_hours: interval }),
    });
    document.getElementById('source-label').value   = '';
    document.getElementById('source-url').value     = '';
    document.getElementById('source-interval').value = '24';
    await loadSources();
    toast(`Source "${label}" added`);
  } catch (err) {
    errEl.textContent = err.message;
  }
}

// ── Stats ──────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const { by_source, totals } = await apiFetch('/discover/stats');
    const el = document.getElementById('discover-stats');

    if (totals.length === 0) {
      el.innerHTML = '<p class="settings-hint">No data yet.</p>';
      return;
    }

    el.innerHTML = `
      <table class="stats-table">
        <thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          ${totals.map(r => `<tr><td>${esc(r.status)}</td><td>${r.n}</td></tr>`).join('')}
        </tbody>
      </table>
      <br>
      <table class="stats-table">
        <thead><tr><th>Source</th><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          ${by_source.map(r => `<tr><td>${esc(r.source_type)}</td><td>${esc(r.status)}</td><td>${r.n}</td></tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (_) {}
}

// ── Settings panel ─────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-panel').style.display  = '';
  document.getElementById('settings-overlay').style.display = '';
  // Sync theme toggle label to current theme
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn && themeBtn.classList.contains('ghost-btn')) {
    themeBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀ Light mode' : '☾ Dark mode';
  }
  loadSources();
  loadStats();
}

function closeSettings() {
  document.getElementById('settings-panel').style.display  = 'none';
  document.getElementById('settings-overlay').style.display = 'none';
}

// ── Run discovery ──────────────────────────────────────────────────
let _discoverPollTimer = null;

function startDiscoverPolling() {
  const bar     = document.getElementById('discover-progress');
  const text    = document.getElementById('discover-progress-text');
  const allBtns = document.querySelectorAll('#run-discover-btn, #empty-run-btn');

  bar.style.display = '';
  allBtns.forEach(b => { b.disabled = true; b.textContent = 'Running…'; });

  _discoverPollTimer = setInterval(async () => {
    try {
      const s = await apiFetch('/discover/running');
      const phase = s.phase === 'rss' ? 'Scraping RSS feeds' : 'Crawling sources';
      text.textContent = s.running
        ? `${phase}… ${s.queued} candidate${s.queued !== 1 ? 's' : ''} found`
        : `Done — ${s.queued} candidate${s.queued !== 1 ? 's' : ''} found`;

      if (!s.running) {
        stopDiscoverPolling();
        loadFeed();
      }
    } catch (_) {}
  }, 1000);
}

function stopDiscoverPolling() {
  clearInterval(_discoverPollTimer);
  _discoverPollTimer = null;
  document.getElementById('discover-progress').style.display = 'none';
  document.querySelectorAll('#run-discover-btn, #empty-run-btn').forEach(b => {
    b.disabled = false;
    b.textContent = 'Run Discovery';
  });
}

async function runDiscovery(btn) {
  try {
    await apiFetch('/discover/run', { method: 'POST' });
    startDiscoverPolling();
  } catch (err) {
    toast(`Failed: ${err.message}`);
  }
}

// ── Load tags (for pill colors) ────────────────────────────────────
async function loadTags() {
  try { allTags = await apiFetch('/tags'); } catch (_) {}
}

// ── Wire up events from main app topbar ───────────────────────────
function wireDiscoverButton() {
  // In index.html the Discover button links to discover.html — no JS needed.
  // This function is a no-op but kept for clarity.
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Grid density
  const savedCols = localStorage.getItem('gotcha-discover-cols');
  if (savedCols) setGridCols(Number(savedCols));

  document.querySelectorAll('.grid-scale-btn').forEach(btn => {
    btn.addEventListener('click', () => setGridCols(Number(btn.dataset.cols)));
  });

  // Run discovery
  document.getElementById('run-discover-btn').addEventListener('click', e => runDiscovery(e.currentTarget));
  document.getElementById('empty-run-btn')?.addEventListener('click', e => runDiscovery(e.currentTarget));
  document.getElementById('load-more-btn')?.addEventListener('click', loadMore);

  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  // Add source
  document.getElementById('add-source-btn').addEventListener('click', addSource);
  document.getElementById('source-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') addSource();
  });

  // Detail panel close
  document.getElementById('detail-close').addEventListener('click', closeSaveDialog);
  document.getElementById('detail-overlay').addEventListener('click', closeSaveDialog);

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('detail-panel').classList.contains('open')) { closeSaveDialog(); return; }
    if (document.getElementById('settings-panel').style.display !== 'none') { closeSettings(); return; }
  });

  await loadTags();
  await loadFeed();

  // If a cycle is already running (e.g. triggered by cron), show the indicator
  try {
    const s = await apiFetch('/discover/running');
    if (s.running) startDiscoverPolling();
  } catch (_) {}
});
