'use strict';
// Sliceview for Windows: the Electron main process.
// It hosts the Sliceview web app (index.html, shared with the browser version) in a hardened window, and adds
// what a desktop program needs: native menus and file dialogs, .dcm file association and "Open with",
// a single running instance, recent studies, saved window placement, native Save for reports, and a log file.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, shell, screen, net, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const lib = require('./lib');

const SCHEME = 'sliceview';
const ORIGIN = SCHEME + '://app';
const ROOT = path.resolve(__dirname, '..');
const IS_TEST = process.env.SLICEVIEW_TEST === '1';
if (process.env.SLICEVIEW_USER_DATA) app.setPath('userData', process.env.SLICEVIEW_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

/* ---------- log ---------- */
let logFile = null;
function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map(x => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n';
  try {
    if (!logFile) { const d = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(d, { recursive: true }); logFile = path.join(d, 'main.log'); try { if (fs.statSync(logFile).size > 2e6) fs.renameSync(logFile, logFile + '.old'); } catch (e) { } }
    fs.appendFileSync(logFile, line);
  } catch (e) { }
  if (IS_TEST || !app.isPackaged) process.stdout.write(line);
}
process.on('uncaughtException', e => log('uncaught', e));
process.on('unhandledRejection', e => log('unhandled', e));

/* ---------- settings ---------- */
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { recent: [] };
function loadSettings() {
  try { settings = Object.assign({ recent: [] }, JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))); } catch (e) { }
  if (!Array.isArray(settings.recent)) settings.recent = [];
}
function saveSettings() {
  try { const p = settingsPath(); fs.writeFileSync(p + '.tmp', JSON.stringify(settings, null, 2)); fs.renameSync(p + '.tmp', p); } catch (e) { log('settings', e); }
}

/* ---------- serving the app ---------- */
const FONT_DIRS = ['@fontsource/inter/files', '@fontsource/ibm-plex-mono/files'].map(d => path.join(ROOT, 'node_modules', d));
const STATIC = new Set(['favicon-32.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:", "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self' blob: data: https: http:", "media-src 'self' blob: data:",
  "object-src 'none'", "base-uri 'none'", "frame-src 'none'", "form-action 'none'"].join('; ');
let indexCache = null;

function resolveAsset(rel) {
  if (rel === '' || rel === 'index.html') return { html: true };
  if (rel === 'desktop-bridge.js') return { file: path.join(ROOT, 'web', 'desktop-bridge.js') };
  if (rel === 'fonts/fonts.css') return { file: path.join(ROOT, 'web', 'fonts.css') };
  const m = /^fonts\/([a-z0-9-]+\.woff2)$/.exec(rel);
  if (m) { for (const d of FONT_DIRS) { const f = path.join(d, m[1]); if (fs.existsSync(f)) return { file: f }; } return null; }
  if (STATIC.has(rel)) return { file: lib.safeJoin(ROOT, rel) };
  return null;
}
async function serve(req) {
  const u = new URL(req.url);
  if (u.host !== 'app') return new Response('Not found', { status: 404 });
  const a = resolveAsset(u.pathname.replace(/^\/+/, ''));
  const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' };
  if (!a) return new Response('Not found', { status: 404, headers });
  if (a.html) {
    if (!indexCache || !app.isPackaged) indexCache = lib.transformIndexHtml(await fs.promises.readFile(path.join(ROOT, 'index.html'), 'utf8'));
    return new Response(indexCache, { headers: Object.assign(headers, { 'Content-Type': TYPES['.html'] }) });
  }
  const r = await net.fetch(pathToFileURL(a.file).toString());
  if (!r.ok) return new Response('Not found', { status: 404, headers });
  return new Response(r.body, { headers: Object.assign(headers, { 'Content-Type': TYPES[path.extname(a.file)] || 'application/octet-stream' }) });
}

/* ---------- files handed to the page ----------
   The page never gets file system access. It is given ids for the files the user chose (dialog, command line,
   file association, recent list) and may read only those, by id. */
const granted = new Map(); let nextId = 1;
let win = null, pageReady = false;
const pending = [];

async function openPaths(paths, how) {
  paths = (paths || []).filter(Boolean);
  if (!paths.length) return;
  if (!win || !pageReady) { pending.push({ paths, how }); return; }
  log('open', how, paths.length + ' path(s)');
  const t0 = Date.now();
  const { files, truncated } = await lib.collectFiles(paths);
  if (!files.length) {
    win.webContents.send('sv:message', { text: 'No files found in ' + (paths.length === 1 ? path.basename(paths[0]) : 'the selection'), ms: 6000 });
    return;
  }
  const list = files.map(f => { const id = nextId++; granted.set(id, f.path); return { id, name: f.name, size: f.size }; });
  log('collected', list.length, 'files in', Date.now() - t0, 'ms', truncated ? '(truncated)' : '');
  for (const p of paths) {
    settings.recent = lib.pushRecent(settings.recent, p);
    if (process.platform === 'win32') app.addRecentDocument(p);
  }
  saveSettings(); buildMenu();
  win.webContents.send('sv:open-files', { files: list, truncated, label: paths.length === 1 ? path.basename(paths[0]) : '' });
}

ipcMain.handle('sv:read-file', async (e, id) => {
  if (!fromApp(e)) throw new Error('denied');
  const p = granted.get(id);
  if (!p) throw new Error('This file is no longer available');
  const buf = await fs.promises.readFile(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
});
ipcMain.handle('sv:release', (e, ids) => { if (fromApp(e) && Array.isArray(ids)) ids.forEach(id => granted.delete(id)); });
ipcMain.handle('sv:open-dialog', async (e, kind) => { if (fromApp(e)) await openDialog(kind === 'folder' ? 'folder' : 'files'); });
ipcMain.handle('sv:info', e => (fromApp(e) ? { version: app.getVersion(), platform: process.platform, electron: process.versions.electron } : null));
ipcMain.handle('sv:save-file', async (e, { filename, data }) => {
  if (!fromApp(e)) throw new Error('denied');
  const name = String(filename || 'report.pdf').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
  const dir = settings.saveDir && fs.existsSync(settings.saveDir) ? settings.saveDir : app.getPath('documents');
  const ext = path.extname(name).slice(1).toLowerCase();
  const r = await dialog.showSaveDialog(win, { title: 'Save', defaultPath: path.join(dir, name), filters: ext === 'pdf' ? [{ name: 'PDF document', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }] : [{ name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePath) return { saved: false };
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  settings.saveDir = path.dirname(r.filePath); saveSettings();
  log('saved', r.filePath);
  return { saved: true, path: r.filePath };
});
ipcMain.on('sv:ready', e => {
  if (!fromApp(e)) return;
  pageReady = true;
  const q = pending.splice(0); q.forEach(x => openPaths(x.paths, x.how));
});
ipcMain.handle('sv:show-in-folder', (e, p) => { if (fromApp(e) && typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });

function fromApp(e) {
  // Only the viewer page itself, never another frame or a page it navigated to. (Custom schemes have an opaque
  // URL origin, so the scheme and host are compared.)
  try { const u = new URL(e.senderFrame.url); return u.protocol === SCHEME + ':' && u.host === 'app' && e.senderFrame === e.sender.mainFrame; } catch (err) { return false; }
}

async function openDialog(kind) {
  if (!win) return;
  const dir = settings.openDir && fs.existsSync(settings.openDir) ? settings.openDir : undefined;
  const r = kind === 'folder'
    ? await dialog.showOpenDialog(win, { title: 'Open a DICOM folder', defaultPath: dir, properties: ['openDirectory', 'multiSelections'] })
    : await dialog.showOpenDialog(win, { title: 'Open DICOM files', defaultPath: dir, properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'DICOM and archives', extensions: ['dcm', 'dicom', 'dic', 'ima', 'zip', '*'] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths.length) return;
  const first = r.filePaths[0];
  settings.openDir = path.dirname(first);
  await openPaths(r.filePaths, kind);
}

/* ---------- window ---------- */
function createWindow() {
  const saved = lib.fitBounds(settings.bounds, screen.getAllDisplays());
  win = new BrowserWindow({
    width: 1400, height: 900, ...(saved || {}), minWidth: 900, minHeight: 600,
    show: false, backgroundColor: '#0a0e10', title: 'Sliceview',
    icon: path.join(ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, spellcheck: false, devTools: !app.isPackaged || IS_TEST || process.argv.includes('--devtools'),
    },
  });
  if (settings.maximized && !IS_TEST) win.maximize();
  win.once('ready-to-show', () => { if (!IS_TEST || process.env.SLICEVIEW_SHOW === '1') win.show(); });
  const keep = () => {
    if (!win || win.isDestroyed()) return;
    settings.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) settings.bounds = win.getBounds();
  };
  win.on('resize', keep); win.on('move', keep);
  win.on('close', () => { keep(); saveSettings(); });
  win.on('closed', () => { win = null; pageReady = false; });

  const wc = win.webContents;
  wc.setVisualZoomLevelLimits(1, 1); // Ctrl + wheel and pinch zoom the image, not the page
  wc.on('before-input-event', (e, inp) => { // Chromium's page zoom keys would fight the viewer's own Ctrl +/-/0
    if (inp.type === 'keyDown' && (inp.control || inp.meta) && ['+', '-', '=', '0'].includes(inp.key) && wc.getZoomLevel() !== 0) wc.setZoomLevel(0);
  });
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) { e.preventDefault(); openExternal(url); } });
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.on('render-process-gone', (e, d) => {
    log('renderer gone', d);
    if (d.reason === 'clean-exit') return;
    dialog.showMessageBox(win, { type: 'error', title: 'Sliceview', message: 'The viewer stopped unexpectedly (' + d.reason + ').', detail: 'It will reload now. Your study can be reopened from the start screen.', buttons: ['Reload'] })
      .then(() => { if (win) { pageReady = false; win.loadURL(ORIGIN + '/index.html'); } });
  });
  wc.on('unresponsive', () => log('renderer unresponsive'));
  wc.on('console-message', (e) => { const m = e.message || ''; if (e.level === 'error' || e.level === 3) log('page error:', m.slice(0, 500)); });
  wc.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) pageReady = false; });
  wc.session.on('will-download', (e, item) => { // fallback; reports are saved through sv:save-file
    const dir = settings.saveDir && fs.existsSync(settings.saveDir) ? settings.saveDir : app.getPath('documents');
    item.setSaveDialogOptions({ defaultPath: path.join(dir, item.getFilename()) });
  });
  win.loadURL(ORIGIN + '/index.html');
  return win;
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') shell.openExternal(u.toString());
  } catch (e) { }
}

/* ---------- menu ---------- */
const send = (ch, arg) => { if (win) win.webContents.send(ch, arg); };
const pageClick = sel => send('sv:click', sel);

function buildMenu() {
  const recent = settings.recent.filter(p => fs.existsSync(p));
  const tpl = [
    { label: '&File', submenu: [
      { label: 'Open &Files…', accelerator: 'CmdOrCtrl+O', click: () => openDialog('files') },
      { label: 'Open F&older…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openDialog('folder') },
      { label: 'Open &Recent', submenu: recent.length ? recent.map((p, i) => ({ label: (i < 9 ? '&' + (i + 1) + '  ' : '') + p.replace(/&/g, '&&'), click: () => openPaths([p], 'recent') }))
        .concat([{ type: 'separator' }, { label: 'Clear Recent', click: () => { settings.recent = []; if (process.platform === 'win32') app.clearRecentDocuments(); saveSettings(); buildMenu(); } }])
        : [{ label: 'No recent studies', enabled: false }] },
      { type: 'separator' },
      { label: 'DICOMweb &Server…', click: () => pageClick('#btnServer') },
      { label: 'Open &Sample Study', click: () => pageClick('#btnSample') },
      { type: 'separator' },
      { label: '&Report…', click: () => pageClick('#btnReport') },
      { type: 'separator' },
      { label: 'E&xit', accelerator: 'Alt+F4', click: () => app.quit() },
    ] },
    { label: '&View', submenu: [
      { label: '&Series', click: () => pageClick('#btnSeries') },
      { label: '&MPR (coronal and sagittal)', click: () => pageClick('#btnMPR') },
      { label: '&Compare two series', click: () => pageClick('#btnCmp') },
      { label: '&Focus (hide controls)', click: () => pageClick('#btnFocus') },
      { label: 'Hide &patient details', click: () => pageClick('#btnPrivacy') },
      { type: 'separator' },
      { label: 'F&ull Screen', accelerator: 'CmdOrCtrl+Shift+F', click: () => { if (win) win.setFullScreen(!win.isFullScreen()); } },
    ] },
    { label: '&Help', submenu: [
      { label: '&Keyboard and Mouse Shortcuts', click: () => pageClick('#btnKeys') },
      { type: 'separator' },
      { label: 'Open &Log Folder', click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')) },
      { label: 'Re&load Viewer', click: () => { if (win) { pageReady = false; win.webContents.reloadIgnoringCache(); } } },
      ...(!app.isPackaged || process.argv.includes('--devtools') ? [{ label: 'Developer Tools', accelerator: 'Ctrl+Shift+I', click: () => win && win.webContents.toggleDevTools() }] : []),
      { type: 'separator' },
      { label: '&About Sliceview', click: about },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function about() {
  dialog.showMessageBox(win, {
    type: 'info', title: 'About Sliceview', message: 'Sliceview ' + app.getVersion(),
    detail: 'Fast DICOM viewer for CT and MRI: MPR, compare, measurements and reports.\n\n' +
      'Electron ' + process.versions.electron + ' · Chromium ' + process.versions.chrome + ' · ' + process.arch + '\n' +
      'Settings and logs: ' + app.getPath('userData'),
    buttons: ['OK'], noLink: true,
  });
}

/* ---------- start ---------- */
if (!IS_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv, cwd) => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    openPaths(lib.argvPaths(argv, cwd), 'second-instance');
  });
  app.on('web-contents-created', (e, wc) => {
    wc.on('will-attach-webview', ev => ev.preventDefault());
  });
  app.whenReady().then(() => {
    loadSettings();
    log('start', app.getVersion(), process.platform, process.arch, 'electron', process.versions.electron);
    protocol.handle(SCHEME, req => serve(req).catch(err => { log('serve', err); return new Response('Error', { status: 500 }); }));
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['clipboard-sanitized-write', 'fullscreen'].includes(perm)));
    session.defaultSession.setPermissionCheckHandler((wc, perm) => ['clipboard-sanitized-write', 'fullscreen'].includes(perm));
    buildMenu();
    createWindow();
    openPaths(lib.argvPaths(process.argv, process.cwd()), 'argv');
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
}

module.exports = { openPaths }; // for tests run through the main process
