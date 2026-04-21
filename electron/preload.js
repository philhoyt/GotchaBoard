'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Mark the document so CSS can apply Electron-specific offsets
// (e.g. padding for the macOS titlebar / traffic lights)
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('electron-app');
});

contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
  openLocalFile: (filename) => ipcRenderer.invoke('open-image-file', filename),
});
