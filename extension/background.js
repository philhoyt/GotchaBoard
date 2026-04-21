chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-gotcha',
    title: 'Save to Gotcha',
    contexts: ['image']
  });
});

// Fetch the image AND upload it to the local server — all from the background
// service worker, which has <all_urls> host permission so CORS is bypassed and
// the browser's cookies for the source site are sent automatically.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'saveImage') return;
  (async () => {
    try {
      // Step 1: fetch the image (CORS bypassed, cookies included)
      const fetchOptions = { credentials: 'include' };
      if (msg.pageUrl) fetchOptions.referrer = msg.pageUrl;
      const imageRes = await fetch(msg.imageUrl, fetchOptions);
      if (!imageRes.ok) throw new Error(`Image fetch failed: HTTP ${imageRes.status}`);

      const mime = (imageRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      const blob = await imageRes.blob();
      const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';

      // Step 2: upload to local GotchaBoard server
      const form = new FormData();
      form.append('image', blob, `image.${ext}`);
      form.append('source_url', msg.imageUrl);
      if (msg.pageTitle) form.append('page_title', msg.pageTitle);
      if (msg.pageUrl) form.append('page_url', msg.pageUrl);
      if (msg.tags?.length) form.append('tags', JSON.stringify(msg.tags));

      const uploadRes = await fetch(`${msg.serverUrl}/api/images/upload`, {
        method: 'POST',
        body: form
      });
      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed: HTTP ${uploadRes.status}`);
      }

      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'save-to-gotcha') return;

  const srcUrl = info.srcUrl || info.pageUrl;
  if (!srcUrl) return;

  chrome.storage.session.set({
    pendingImage: {
      srcUrl,
      pageUrl: tab.url,
      pageTitle: tab.title
    }
  }, () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html'),
      type: 'popup',
      width: 420,
      height: 580,
      focused: true
    });
  });
});
