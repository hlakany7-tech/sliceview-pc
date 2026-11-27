'use strict';
// Pure helpers used by the main process. Kept free of Electron imports so they can be unit tested with plain Node.
const fs = require('fs');
const path = require('path');

// Files that are never images on a DICOM CD or PACS export (same rule the web app uses for dropped folders).
const SKIP_RE = /^(DICOMDIR|LOCKFILE|VERSION|AUTORUN\.INF|desktop\.ini|thumbs\.db|\..*|.*\.(exe|dll|ini|txt|htm|html|xml|pdf|jpg|jpeg|png|gif|bmp|js|css|inf|lnk|cab|msi|bat|cmd|sys|ico|json|log))$/i;
const MAX_FILES = 100000;
const MAX_DEPTH = 32;

function isSkipped(name) { return SKIP_RE.test(name); }

// Expand files and folders into a flat, sorted list of candidate image files: [{ path, name, size }].
// A DICOMDIR file stands for the folder that holds it (the usual layout of a CD). Unreadable entries are skipped.
async function collectFiles(inputs, opts = {}) {
  const max = opts.max || MAX_FILES;
  const out = [], seen = new Set();
  const add = (p, st) => {
    const key = process.platform === 'win32' ? p.toLowerCase() : p;
    if (seen.has(key) || out.length >= max) return;
    seen.add(key); out.push({ path: p, name: path.basename(p), size: st.size });
  };
  const walk = async (dir, depth) => {
    if (depth > MAX_DEPTH || out.length >= max) return;
    let ents;
    try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const en of ents) {
      if (out.length >= max) return;
      const p = path.join(dir, en.name);
      if (en.isDirectory()) { if (!en.name.startsWith('.') && !/^(\$RECYCLE\.BIN|System Volume Information)$/i.test(en.name)) await walk(p, depth + 1); }
      else if (en.isFile() && !isSkipped(en.name)) { try { add(p, await fs.promises.stat(p)); } catch (e) { } }
    }
  };
  for (const raw of inputs || []) {
    if (typeof raw !== 'string' || !raw) continue;
    const p = path.resolve(raw);
    let st;
    try { st = await fs.promises.stat(p); } catch (e) { continue; }
    if (st.isDirectory()) await walk(p, 0);
    else if (st.isFile()) {
      if (/^DICOMDIR$/i.test(path.basename(p))) await walk(path.dirname(p), 0);
      else add(p, st); // a file the user picked by name is always tried, whatever its extension
    }
  }
  return { files: out, truncated: out.length >= max };
}

// Paths passed on the command line (file association, "Open with", a second launch). Flags and the exe are dropped.
function argvPaths(argv, cwd) {
  const appRoot = path.resolve(__dirname, '..');
  const out = [];
  for (const a of (argv || []).slice(1)) {
    if (typeof a !== 'string' || !a || a.startsWith('-') || a === '.') continue;
    const p = path.resolve(cwd || process.cwd(), a);
    if (p === appRoot || /\.(exe|asar)$/i.test(p)) continue;
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

// The web app is shared with the browser version. For the desktop build, at serve time: fonts come from the
// app itself (works offline), the desktop bridge script is added, and the service worker is not registered.
function transformIndexHtml(html) {
  let s = html.replace(/<link[^>]+fonts\.googleapis\.com[^>]*>/g, '<link rel="stylesheet" href="fonts/fonts.css">');
  s = s.replace(/<link rel="manifest"[^>]*>/, '');
  s = s.replace(/if \('serviceWorker' in navigator\)[^\n]*\n?/, '');
  const tag = '<script src="desktop-bridge.js"></script>\n';
  const i = s.lastIndexOf('</body>');
  s = i >= 0 ? s.slice(0, i) + tag + s.slice(i) : s + tag;
  return s;
}

// Recent list: newest first, unique, only paths that still exist, at most n.
function pushRecent(list, p, n = 10) {
  const key = x => (process.platform === 'win32' ? x.toLowerCase() : x);
  return [p].concat((list || []).filter(x => key(x) !== key(p))).filter(x => { try { return fs.existsSync(x); } catch (e) { return false; } }).slice(0, n);
}

// Keep a saved window inside one of the current displays; returns null when it would be off screen.
function fitBounds(b, displays) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !(b.width > 200) || !(b.height > 200)) return null;
  for (const d of displays || []) {
    const a = d.workArea || d.bounds;
    const ix = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const iy = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    if (ix >= 100 && iy >= 60) {
      return { x: b.x, y: b.y, width: Math.min(b.width, a.width), height: Math.min(b.height, a.height) };
    }
  }
  return null;
}

// Resolve a request path inside a root folder; null for anything that escapes it.
function safeJoin(root, rel) {
  let dec;
  try { dec = decodeURIComponent(rel); } catch (e) { return null; }
  if (dec.includes('\0')) return null;
  const p = path.resolve(root, '.' + path.posix.normalize('/' + dec.replace(/\\/g, '/')));
  const r = path.resolve(root);
  return p === r || p.startsWith(r + path.sep) ? p : null;
}

module.exports = { collectFiles, argvPaths, transformIndexHtml, pushRecent, fitBounds, safeJoin, isSkipped, SKIP_RE };
