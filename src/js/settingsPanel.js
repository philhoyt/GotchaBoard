import { stateManager } from './stateManager.js';
import { API, apiFetch } from './api.js';
import { toast } from './utils/toast.js';

export function openSettings() {
  document.getElementById('settings-panel').style.display   = '';
  document.getElementById('settings-overlay').style.display = '';
  document.getElementById('server-url-display').textContent = window.location.origin;
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn && themeBtn.classList.contains('ghost-btn')) {
    themeBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀ Light mode' : '☾ Dark mode';
  }
}

export function closeSettings() {
  document.getElementById('settings-panel').style.display   = 'none';
  document.getElementById('settings-overlay').style.display = 'none';
  document.getElementById('delete-all-confirm').style.display = 'none';
  document.getElementById('delete-all-initial').style.display = '';
}

export function exportData() {
  window.location.href = API.replace('/api', '') + '/api/transfer/export';
}

export async function importData(input) {
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

export function initSettingsPanel() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  document.querySelector('[data-action="export"]')?.addEventListener('click', exportData);
  document.querySelector('.export-btn')?.addEventListener('click', exportData);
  const restoreInput = document.querySelector('.restore-input');
  if (restoreInput) restoreInput.addEventListener('change', e => importData(e.target));

  document.getElementById('copy-server-url-btn').addEventListener('click', () => {
    const url = window.location.origin;
    navigator.clipboard.writeText(url).then(() => toast('Copied!'));
  });

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
      await stateManager.loadAll();
      toast(`Deleted ${res.deleted.toLocaleString()} Got${res.deleted !== 1 ? 's' : ''}`);
    } catch (err) {
      toast('Delete failed: ' + err.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Yes, delete all';
    }
  });
}
