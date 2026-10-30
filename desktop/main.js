'use strict';

/**
 * Desktop app for Prabh's CSC: runs apps/skill-connector in its own window.
 *
 * The page gets no Node access (sandboxed, context-isolated). It can only reach
 * the two GitHub hosts that "Add from GitHub" needs; every other request is
 * blocked, and links open in the default browser instead of inside the app.
 */

const path = require('path');
const { app, BrowserWindow, Menu, nativeTheme, session, shell } = require('electron');

const APP_DIR = path.join(__dirname, '..', 'apps', 'skill-connector');
const ICON = path.join(__dirname, 'app.ico');
const NETWORK_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com']);
const PERMISSIONS = new Set(['fileSystem', 'clipboard-sanitized-write']);

app.setAppUserModelId('com.tufflerp.prabhs-csc');

/** Open http(s) links in the default browser; ignore anything else. */
function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') shell.openExternal(url);
  } catch {
    // Not a valid URL: nothing to open.
  }
}

function lockDownSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => PERMISSIONS.has(permission));
  ses.webRequest.onBeforeRequest((details, callback) => {
    const { protocol, hostname } = new URL(details.url);
    const local = ['file:', 'data:', 'blob:', 'devtools:'].includes(protocol);
    callback({ cancel: !(local || (protocol === 'https:' && NETWORK_HOSTS.has(hostname))) });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 480,
    show: false,
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#262624' : '#faf9f5',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Reconnect the saved skills folder so Connect is only ever needed once. Chromium
  // forgets folder access on restart and only asks again after a click, so this runs
  // as a user gesture; the permission handler above then allows it.
  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript('window.SkillConnector && window.SkillConnector.restoreAccess()', true)
      .catch(() => {});
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] === win.webContents.getURL().split('#')[0]) return;
    event.preventDefault();
    openExternal(url);
  });
  win.loadFile(path.join(APP_DIR, 'index.html'));
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    lockDownSession();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
