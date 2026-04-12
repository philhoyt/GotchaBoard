'use strict';

// Mark the document so CSS can apply Electron-specific offsets
// (e.g. padding for the macOS titlebar / traffic lights)
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron-app');
});
