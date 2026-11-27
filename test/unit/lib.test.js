'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../../electron/lib');
const { writeSeries } = require('../fixtures/dicom');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'svpc-'));

test('collectFiles walks folders, skips junk, sorts naturally', async () => {
  const d = tmp();
  writeSeries(d, { count: 12 });
  fs.mkdirSync(path.join(d, '.hidden')); fs.writeFileSync(path.join(d, '.hidden', 'x.dcm'), 'x');
  fs.writeFileSync(path.join(d, 'DICOMDIR'), 'dir');
  const { files, truncated } = await lib.collectFiles([d]);
  assert.equal(truncated, false);
  assert.equal(files.length, 12);
  assert.ok(files.every(f => /^I\d{4}$/.test(f.name) && f.size > 8000));
  assert.deepEqual(files.map(f => f.name), [...Array(12)].map((_, i) => 'I' + String(i + 1).padStart(4, '0')));
});

test('collectFiles: DICOMDIR stands for its folder; explicit files always kept; duplicates once', async () => {
  const d = tmp();
  writeSeries(d, { count: 3 });
  fs.writeFileSync(path.join(d, 'DICOMDIR'), 'dir');
  const odd = path.join(d, 'scan.txt'); fs.writeFileSync(odd, 'picked by name');
  const { files } = await lib.collectFiles([path.join(d, 'DICOMDIR'), odd, odd, d, path.join(d, 'missing')]);
  assert.equal(files.length, 4);
  assert.ok(files.some(f => f.name === 'scan.txt'));
});

test('collectFiles respects the maximum', async () => {
  const d = tmp(); writeSeries(d, { count: 9 });
  const r = await lib.collectFiles([d], { max: 5 });
  assert.equal(r.files.length, 5); assert.equal(r.truncated, true);
});

test('argvPaths keeps existing paths and drops flags, the exe and the app folder', () => {
  const d = tmp(); const f = path.join(d, 'a.dcm'); fs.writeFileSync(f, 'x');
  const appRoot = path.resolve(__dirname, '../..');
  const out = lib.argvPaths(['C:/Sliceview/Sliceview.exe', '--allow-file-access', '.', appRoot, f, path.join(d, 'nope.dcm'), 'Sliceview.exe'], d);
  assert.deepEqual(out, [f]);
});

test('transformIndexHtml: local fonts, bridge injected, no service worker or manifest', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
  const out = lib.transformIndexHtml(src);
  assert.ok(!out.includes('fonts.googleapis.com'));
  assert.ok(out.includes('href="fonts/fonts.css"'));
  assert.ok(!out.includes("navigator.serviceWorker.register"));
  assert.ok(!/<link rel="manifest"/.test(out));
  assert.ok(/<script src="desktop-bridge.js"><\/script>\s*<\/body>/.test(out));
  assert.equal((out.match(/desktop-bridge\.js/g) || []).length, 1);
});

test('pushRecent: newest first, unique, existing only, capped', () => {
  const d = tmp(); const ps = [...Array(12)].map((_, i) => { const p = path.join(d, 'f' + i); fs.writeFileSync(p, ''); return p; });
  let list = [];
  for (const p of ps) list = lib.pushRecent(list, p);
  assert.equal(list.length, 10); assert.equal(list[0], ps[11]);
  list = lib.pushRecent(list.concat([path.join(d, 'gone')]), ps[5]);
  assert.equal(list[0], ps[5]); assert.equal(list.filter(x => x === ps[5]).length, 1); assert.ok(!list.includes(path.join(d, 'gone')));
});

test('fitBounds keeps windows on a screen', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  assert.deepEqual(lib.fitBounds({ x: 100, y: 100, width: 1200, height: 800 }, displays), { x: 100, y: 100, width: 1200, height: 800 });
  assert.equal(lib.fitBounds({ x: 5000, y: 100, width: 1200, height: 800 }, displays), null);
  assert.equal(lib.fitBounds({ x: 0, y: 0, width: 50, height: 50 }, displays), null);
  assert.equal(lib.fitBounds(null, displays), null);
  assert.equal(lib.fitBounds({ x: 0, y: 0, width: 4000, height: 3000 }, displays).width, 1920);
});

test('safeJoin blocks path traversal', () => {
  const root = path.resolve('/srv/app');
  assert.equal(lib.safeJoin(root, 'icon-192.png'), path.join(root, 'icon-192.png'));
  assert.equal(lib.safeJoin(root, '../etc/passwd'), path.join(root, 'etc/passwd'));
  assert.equal(lib.safeJoin(root, '%2e%2e%2f%2e%2e%2fsecret'), path.join(root, 'secret'));
  assert.equal(lib.safeJoin(root, '..\\..\\win.ini'), path.join(root, 'win.ini'));
  assert.equal(lib.safeJoin(root, 'a\0b'), null);
  assert.equal(lib.safeJoin(root, '%E0%A4%A'), null);
});
