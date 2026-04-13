const DEFAULT_SERVER = 'http://localhost:47315';

async function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get('serverUrl', (result) => {
      resolve((result.serverUrl || DEFAULT_SERVER).replace(/\/+$/, ''));
    });
  });
}

let pendingImage = null;

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

function showError(message) {
  document.getElementById('save-form').style.display = 'none';
  document.getElementById('loading').style.display = 'none';
  const errState = document.getElementById('error-state');
  document.getElementById('error-message').textContent = message;
  errState.style.display = 'block';
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
  } catch (_) {
    // Non-critical
  }
}

async function init() {
  // Pre-fill server URL input
  const serverUrl = await getServerUrl();
  document.getElementById('server-url-input').value = serverUrl;

  // Try to get pending image from storage
  try {
    const result = await new Promise((resolve) => {
      chrome.storage.session.get('pendingImage', resolve);
    });
    pendingImage = result.pendingImage || null;
  } catch (_) {
    // Fallback for Chrome < 102 — try local storage
    try {
      const result = await new Promise((resolve) => {
        chrome.storage.local.get('pendingImage', resolve);
      });
      pendingImage = result.pendingImage || null;
      if (pendingImage) {
        chrome.storage.local.remove('pendingImage');
      }
    } catch (_) {}
  }

  if (!pendingImage || !pendingImage.srcUrl) {
    showError('No image selected. Right-click an image and choose "Save to Gotcha".');
    return;
  }

  // Show preview
  const img = document.getElementById('preview-img');
  img.style.display = 'block';
  document.getElementById('preview-placeholder').style.display = 'none';
  img.src = pendingImage.srcUrl;
  img.onerror = () => {
    img.style.display = 'none';
    document.getElementById('preview-placeholder').style.display = 'block';
  };

  await checkDuplicate(pendingImage.srcUrl);
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      showError('GotchaBoard server is not running.\n\nStart it with: npm start');
    } else {
      showError(`Error: ${err.message}`);
    }
  });

  // Settings toggle
  document.getElementById('settings-toggle').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // Save server URL
  document.getElementById('save-server-btn').addEventListener('click', () => {
    const url = document.getElementById('server-url-input').value.trim().replace(/\/+$/, '');
    if (url) {
      chrome.storage.local.set({ serverUrl: url });
      showStatus('Server URL saved!', 'success');
      document.getElementById('settings-panel').style.display = 'none';
    }
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
        showError('GotchaBoard server is not running.\n\nStart it with: npm start');
      } else {
        showError(`Failed to save: ${err.message}`);
      }
    }
  });
});
