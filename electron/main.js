'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const net  = require('net');

app.setName('Gotcha');

const IS_PACKAGED = app.isPackaged;

// ── Storage path ───────────────────────────────────────────────────
// Dev:        ./storage/ (project root, existing behaviour)
// Packaged:   ~/Library/Application Support/GotchaBoard/storage/  (Mac)
//             %APPDATA%/GotchaBoard/storage/                       (Win)
const STORAGE_ROOT = IS_PACKAGED
  ? path.join(app.getPath('userData'), 'storage')
  : path.join(__dirname, '..', 'storage');

process.env.GOTCHA_STORAGE = STORAGE_ROOT;

// ── Port selection ─────────────────────────────────────────────────
// Use a fixed port so localStorage origin stays stable across launches
// (random ports = new origin each launch = lost theme/prefs every open).
// Fall back to a random free port only if the fixed one is in use.
const PREFERRED_PORT = 47315;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(PREFERRED_PORT, '127.0.0.1', () => {
      srv.close(() => resolve(PREFERRED_PORT));
    });
    srv.on('error', () => {
      // Fixed port busy — fall back to OS-assigned port
      const fallback = net.createServer();
      fallback.listen(0, '127.0.0.1', () => {
        const { port } = fallback.address();
        fallback.close(() => resolve(port));
      });
      fallback.on('error', reject);
    });
  });
}

// ── Poll until server is accepting connections ────────────────────
function waitForServer(port, retries = 30, delay = 200) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const try_ = () => {
      const sock = net.createConnection(port, '127.0.0.1');
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error', () => {
        sock.destroy();
        if (++attempts >= retries) return reject(new Error('Server never started'));
        setTimeout(try_, delay);
      });
    };
    try_();
  });
}

// ── Main ───────────────────────────────────────────────────────────
let mainWindow = null;

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 500,
    title: 'GotchaBoard',
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Open external links in the system browser, not in the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    const port = await getFreePort();
    process.env.PORT = String(port);

    // Start the Express server in-process
    require('../server/index.js');

    // Wait until it's accepting connections
    await waitForServer(port);

    await createWindow(port);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  } catch (err) {
    console.error('[electron] Startup failed:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
