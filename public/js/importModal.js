'use strict';

(function () {
  const API = window.location.origin + '/api';

  let currentJobId  = null;
  let eventSource   = null;

  // ── Escape helper ─────────────────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── State management ──────────────────────────────────────────────
  function showState(state) {
    ['upload', 'preview', 'progress', 'done'].forEach(s => {
      const el = document.getElementById(`import-${s}-state`);
      if (el) el.style.display = s === state ? '' : 'none';
    });
  }

  // ── Open / close ──────────────────────────────────────────────────
  function openImportModal() {
    // Close settings panel if open
    const settingsPanel = document.getElementById('settings-panel');
    const settingsOverlay = document.getElementById('settings-overlay');
    if (settingsPanel)  settingsPanel.style.display  = 'none';
    if (settingsOverlay) settingsOverlay.style.display = 'none';

    resetModal();
    document.getElementById('import-modal').style.display = '';
    showState('upload');
  }

  function closeImportModal() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    document.getElementById('import-modal').style.display = 'none';
  }

  function resetModal() {
    currentJobId = null;
    if (eventSource) { eventSource.close(); eventSource = null; }
    const input = document.getElementById('import-file-input');
    if (input) input.value = '';
    const errEl = document.getElementById('import-dropzone-error');
    if (errEl) errEl.textContent = '';
    const zone = document.getElementById('import-dropzone');
    if (zone) {
      zone.classList.remove('loading', 'drag-over');
      zone.querySelector('.import-dropzone-label').textContent =
        'Drop your Pinterest export ZIP here, or click to browse';
    }
  }

  // ── Upload / drag-drop ────────────────────────────────────────────
  function initDropzone() {
    const zone  = document.getElementById('import-dropzone');
    const input = document.getElementById('import-file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    });

    input.addEventListener('change', e => {
      if (e.target.files[0]) uploadFile(e.target.files[0]);
    });
  }

  async function uploadFile(file) {
    const errEl = document.getElementById('import-dropzone-error');
    errEl.textContent = '';

    const zone = document.getElementById('import-dropzone');
    zone.classList.add('loading');
    zone.querySelector('.import-dropzone-label').textContent = 'Parsing export…';

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res  = await fetch(`${API}/import/pinterest/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      currentJobId = data.job_id;
      showPreview(data);
    } catch (err) {
      errEl.textContent = err.message;
      zone.classList.remove('loading');
      zone.querySelector('.import-dropzone-label').textContent =
        'Drop your Pinterest export ZIP here, or click to browse';
    }
  }

  // ── Preview state ─────────────────────────────────────────────────
  function showPreview(data) {
    showState('preview');

    document.getElementById('import-preview-total').textContent  = data.total_pins.toLocaleString();
    document.getElementById('import-preview-boards').textContent = data.boards.length.toLocaleString();

    const list = document.getElementById('import-boards-list');
    list.innerHTML = data.boards.map(b => `
      <div class="import-board-row">
        <span class="import-board-name">${esc(b.name)}</span>
        <span class="import-board-count">${b.count.toLocaleString()}</span>
      </div>
    `).join('');
  }

  // ── Start import ──────────────────────────────────────────────────
  async function startImport() {
    if (!currentJobId) return;

    showState('progress');
    renderProgress({ done: 0, failed: 0, skipped: 0, no_hash: 0, total: 0, status: 'running' });

    try {
      const res  = await fetch(`${API}/import/pinterest/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_id: currentJobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      connectSSE(currentJobId);
    } catch (err) {
      showState('upload');
      document.getElementById('import-dropzone-error').textContent = err.message;
    }
  }

  // ── SSE progress stream ───────────────────────────────────────────
  function connectSSE(jobId) {
    eventSource = new EventSource(`${API}/import/pinterest/progress/${jobId}`);

    eventSource.onmessage = e => {
      const data = JSON.parse(e.data);
      renderProgress(data);

      if (['done', 'error', 'cancelled'].includes(data.status)) {
        eventSource.close();
        eventSource = null;

        if (data.status === 'error') {
          document.getElementById('import-progress-error').textContent =
            data.error || 'Import failed';
        } else {
          showDone(data);
        }
      }
    };

    eventSource.onerror = () => {
      if (eventSource) { eventSource.close(); eventSource = null; }
    };
  }

  function renderProgress(data) {
    const total = data.total || 0;
    const done  = data.done  || 0;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

    const fill = document.getElementById('import-progress-bar-fill');
    if (fill) fill.style.width = `${pct}%`;

    const label = document.getElementById('import-progress-label');
    if (label) label.textContent = `${done.toLocaleString()} / ${total.toLocaleString()}`;

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (val || 0).toLocaleString();
    };
    set('import-stat-done',    data.done);
    set('import-stat-skipped', data.skipped);
    set('import-stat-failed',  data.failed);

    const noHashRow = document.getElementById('import-stat-nohash-row');
    if (noHashRow && data.no_hash > 0) {
      noHashRow.style.display = '';
      set('import-stat-nohash', data.no_hash);
    }
  }

  // ── Done state ────────────────────────────────────────────────────
  function showDone(data) {
    showState('done');

    const heading = document.getElementById('import-done-heading');
    if (heading) heading.textContent =
      data.status === 'cancelled' ? 'Import cancelled' : 'Import complete';

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (val || 0).toLocaleString();
    };
    set('import-done-done',    data.done);
    set('import-done-skipped', data.skipped);
    set('import-done-failed',  data.failed);
  }

  // ── Cancel ────────────────────────────────────────────────────────
  async function cancelImport() {
    if (!currentJobId) return;
    try {
      await fetch(`${API}/import/pinterest/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ job_id: currentJobId }),
      });
    } catch (_) {}
  }

  // ── Init ──────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initDropzone();

    document.getElementById('import-btn')
      ?.addEventListener('click', openImportModal);

    document.getElementById('import-close')
      ?.addEventListener('click', closeImportModal);
    document.getElementById('import-backdrop')
      ?.addEventListener('click', closeImportModal);

    document.getElementById('import-cancel-preview')
      ?.addEventListener('click', closeImportModal);
    document.getElementById('import-start-btn')
      ?.addEventListener('click', startImport);

    document.getElementById('import-cancel-progress')
      ?.addEventListener('click', cancelImport);

    document.getElementById('import-done-close')
      ?.addEventListener('click', () => {
        closeImportModal();
        // Refresh grid + tags so newly imported pins appear
        if (typeof loadAll === 'function') loadAll();
      });

    // Escape key
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const modal = document.getElementById('import-modal');
      if (modal && modal.style.display !== 'none') closeImportModal();
    });
  });

})();
