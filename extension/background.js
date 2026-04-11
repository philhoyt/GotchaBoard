// Register context menu only on install/update to avoid duplicates
// (Service workers can wake/sleep, so top-level registration would duplicate the menu)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-gotcha',
    title: 'Save to Gotcha',
    contexts: ['image']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'save-to-gotcha') return;

  const srcUrl = info.srcUrl || info.pageUrl;
  if (!srcUrl) return;

  // Store pending image data so the popup can read it
  chrome.storage.session.set({
    pendingImage: {
      srcUrl,
      pageUrl: tab.url,
      pageTitle: tab.title
    }
  }, () => {
    // Open popup window
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html'),
      type: 'popup',
      width: 420,
      height: 580,
      focused: true
    });
  });
});
