const DEFAULT_SERVER = 'http://localhost:47315';

async function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get('serverUrl', (result) => {
      resolve((result.serverUrl || DEFAULT_SERVER).replace(/\/+$/, ''));
    });
  });
}

let pendingImage = null;
let selectedImages = [];
let pageUrl = '';
let pageTitle = '';

function showStatus(message, type = 'warning') {
  const bar = document.getElementById('status-bar');
  bar.textContent = message;
  bar.style.display = 'block';
  if (type === 'error') {
    bar.style.background = '#fee2e2';
    bar.style.borderColor = '#f87171';
    bar.style.color = '#991b1b';
  } else if (type === 'success') {
    bar.style.background = '#d1fae5';
    bar.style.borderColor = '#34d399';
    bar.style.color = '#065f46';
  } else {
    bar.style.background = '#fef3c7';
    bar.style.borderColor = '#f59e0b';
    bar.style.color = '#92400e';
  }
}

function showLoading() {
  document.getElementById('save-form').style.display = 'none';
  document.getElementById('loading').style.display = 'flex';
}

function showSuccess() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('success').style.display = 'flex';
}

function showSaveError(message) {
  document.getElementById('save-form').style.display = 'none';
  document.getElementById('loading').style.display = 'none';
  const errState = document.getElementById('error-state');
  document.getElementById('error-message').textContent = message;
  errState.style.display = 'block';
}

function showTopError(message) {
  document.getElementById('top-error-message').textContent = message;
  document.getElementById('top-error').style.display = 'block';
}

async function checkDuplicate(url) {
  try {
    const serverUrl = await getServerUrl();
    const res = await fetch(`${serverUrl}/api/images/check-duplicate?url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.duplicate) {
      showStatus('This image may already be saved. You can save it again or cancel.');
    }
  } catch (_) {}
}

// ── Picker ──────────────────────────────────────────────

function toggleSelection(src, itemEl) {
  const idx = selectedImages.indexOf(src);
  if (idx === -1) {
    selectedImages.push(src);
    itemEl.classList.add('selected');
  } else {
    selectedImages.splice(idx, 1);
    itemEl.classList.remove('selected');
  }
  updateSelectionBar();
}

function updateSelectionBar() {
  const bar = document.getElementById('selection-bar');
  const saveBtn = document.getElementById('picker-save-btn');
  const n = selectedImages.length;

  if (n === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'block';
  saveBtn.textContent = n === 1 ? 'Save 1 Image' : `Save ${n} Images`;
}

function renderPickerGrid(images) {
  const loading = document.getElementById('picker-loading');
  const grid = document.getElementById('picker-grid');
  const empty = document.getElementById('picker-empty');
  const count = document.getElementById('picker-count');

  loading.style.display = 'none';

  if (images.length === 0) {
    empty.style.display = 'block';
    return;
  }

  count.textContent = `${images.length} found`;

  images.forEach(src => {
    const item = document.createElement('div');
    item.className = 'picker-item';

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.onerror = () => { item.style.display = 'none'; };

    const check = document.createElement('div');
    check.className = 'picker-check';
    check.textContent = '✓';

    item.appendChild(img);
    item.appendChild(check);
    item.addEventListener('click', () => toggleSelection(src, item));
    grid.appendChild(item);
  });

  grid.style.display = 'grid';
}

async function showPicker() {
  document.getElementById('picker-view').style.display = 'block';
  document.getElementById('save-view').style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const seen = new Set();
        const images = [];
        document.querySelectorAll('img').forEach(img => {
          const src = img.currentSrc || img.src;
          if (!src || src.startsWith('data:') || seen.has(src)) return;

          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (w < 150 || h < 150) return;

          // Skip extreme aspect ratios (banners, logos, icons)
          const ratio = w / h;
          if (ratio > 3 || ratio < 0.33) return;

          // Skip images inside navigational/header elements
          if (img.closest('nav, header, [role="banner"], [role="navigation"]')) return;

          seen.add(src);
          images.push(src);
        });
        return {
          images,
          pageUrl: window.location.href,
          pageTitle: document.title
        };
      }
    });

    const result = results[0]?.result || { images: [], pageUrl: '', pageTitle: '' };
    pageUrl = result.pageUrl;
    pageTitle = result.pageTitle;
    renderPickerGrid(result.images);
  } catch (err) {
    document.getElementById('picker-loading').style.display = 'none';
    showTopError(`Could not scan page: ${err.message}`);
  }
}

async function saveSelectedImages() {
  const tags = document.getElementById('picker-tags-input').value
    .split(',').map(t => t.trim()).filter(t => t.length > 0);

  const toSave = [...selectedImages];
  const total = toSave.length;

  document.getElementById('selection-bar').style.display = 'none';
  document.getElementById('picker-grid').style.display = 'none';
  document.getElementById('picker-bar').style.display = 'none';

  const saving = document.getElementById('picker-saving');
  const savingLabel = document.getElementById('picker-saving-label');
  saving.style.display = 'flex';

  const serverUrl = await getServerUrl();
  let saved = 0;
  let failed = 0;

  for (let i = 0; i < toSave.length; i++) {
    savingLabel.textContent = total > 1
      ? `Saving ${i + 1} of ${total}...`
      : 'Saving...';

    try {
      const res = await fetch(`${serverUrl}/api/images/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_url: toSave[i],
          page_title: pageTitle || null,
          page_url: pageUrl || null,
          tags
        })
      });
      if (res.ok) saved++;
      else failed++;
    } catch (_) {
      failed++;
    }
  }

  saving.style.display = 'none';

  const successEl = document.getElementById('picker-success');
  const successLabel = document.getElementById('picker-success-label');

  if (failed === 0) {
    successLabel.textContent = saved === 1 ? 'Saved!' : `Saved ${saved} images!`;
  } else if (saved === 0) {
    successLabel.textContent = 'Failed to save. Is the server running?';
  } else {
    successLabel.textContent = `Saved ${saved}, failed ${failed}.`;
  }

  successEl.style.display = 'flex';
  setTimeout(() => window.close(), 1500);
}

// ── Single-image save (right-click flow) ────────────────

function showSaveView() {
  document.getElementById('picker-view').style.display = 'none';
  document.getElementById('save-view').style.display = 'block';

  const img = document.getElementById('preview-img');
  img.style.display = 'block';
  document.getElementById('preview-placeholder').style.display = 'none';
  img.src = pendingImage.srcUrl;
  img.onerror = () => {
    img.style.display = 'none';
    document.getElementById('preview-placeholder').style.display = 'block';
  };

  checkDuplicate(pendingImage.srcUrl);
}

// ── Init ────────────────────────────────────────────────

async function init() {
  const serverUrl = await getServerUrl();
  document.getElementById('server-url-input').value = serverUrl;

  try {
    const result = await new Promise((resolve) => {
      chrome.storage.session.get('pendingImage', resolve);
    });
    pendingImage = result.pendingImage || null;
    if (pendingImage) chrome.storage.session.remove('pendingImage');
  } catch (_) {
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get('pendingImage', resolve);
      });
      pendingImage = result.pendingImage || null;
      if (pendingImage) chrome.storage.local.remove('pendingImage');
    } catch (_) {}
  }

  if (pendingImage?.srcUrl) {
    showSaveView();
  } else {
    await showPicker();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => {
    showTopError(`Error: ${err.message}`);
  });

  document.getElementById('settings-toggle').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('save-server-btn').addEventListener('click', () => {
    const url = document.getElementById('server-url-input').value.trim().replace(/\/+$/, '');
    if (url) {
      chrome.storage.local.set({ serverUrl: url });
      showStatus('Server URL saved!', 'success');
      document.getElementById('settings-panel').style.display = 'none';
    }
  });

  document.getElementById('picker-cancel-btn').addEventListener('click', () => {
    window.close();
  });

  document.getElementById('picker-save-btn').addEventListener('click', () => {
    if (selectedImages.length > 0) saveSelectedImages();
  });

  document.getElementById('cancel-btn').addEventListener('click', () => {
    window.close();
  });

  document.getElementById('save-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pendingImage) return;

    const tagsRaw = document.getElementById('tags-input').value;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0);

    showLoading();

    try {
      const serverUrl = await getServerUrl();
      const res = await fetch(`${serverUrl}/api/images/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_url: pendingImage.srcUrl,
          page_title: pendingImage.pageTitle || null,
          page_url: pendingImage.pageUrl || null,
          tags
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      showSuccess();
      setTimeout(() => window.close(), 1200);
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        showSaveError('GotchaBoard server is not running.\n\nStart it with: npm start');
      } else {
        showSaveError(`Failed to save: ${err.message}`);
      }
    }
  });
});
