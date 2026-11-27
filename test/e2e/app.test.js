'use strict';
// End-to-end tests: start the real desktop app (Electron main process + the viewer page) and drive it.
// Run under a display (on Linux CI: xvfb-run). Uses playwright-core's Electron support.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright-core');
const { writeSeries } = require('../fixtures/dicom');

const ROOT = path.resolve(__dirname, '../..');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function launch(userData, extra = []) {
  // SLICEVIEW_EXE: test a packaged build instead of the sources (npm run dist:linux-test).
  const exe = process.env.SLICEVIEW_EXE;
  const app = await electron.launch({
    ...(exe ? { executablePath: exe, args: extra } : { args: [ROOT, ...extra] }), cwd: ROOT,
    env: { ...process.env, SLICEVIEW_TEST: '1', SLICEVIEW_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForFunction(() => window.__sliceview && window.sliceviewDesktop && document.documentElement.classList.contains('desktop'));
  return { app, page, errors };
}
const seriesInfo = page => page.evaluate(() => window.__sliceview.S.series.map(s => ({ n: s.images.length, desc: s.desc, uid: s.uid })));
const waitSeries = (page, n) => page.waitForFunction(k => window.__sliceview.S.series.filter(s => s.uid !== 'sample-phantom').length >= k, n, { timeout: 30000 });

const data = tmp('svpc-data-');
const study1 = path.join(data, 'CD1'); writeSeries(study1, { count: 12, seriesNo: 1, desc: 'Head axial' });
const study2 = path.join(data, 'CD2'); writeSeries(study2, { count: 7, seriesNo: 2, desc: 'Chest axial', ext: '.dcm' });

test('starts, serves the viewer from the app itself, opens a folder from the command line', async () => {
  const ud = tmp('svpc-ud-');
  const { app, page, errors } = await launch(ud, [study1]);
  try {
    assert.equal(await page.title(), 'Sliceview');
    assert.equal(page.url().replace(/^(sliceview:\/\/app)\/.*$/, '$1'), 'sliceview://app');
    await waitSeries(page, 1);
    const s = await seriesInfo(page);
    assert.equal(s.length, 1); assert.equal(s[0].n, 12); assert.equal(s[0].desc, 'Head axial');
    // the image is drawn
    const drawn = await page.evaluate(() => { const c = document.getElementById('cv'); return c.width > 0 && c.height > 0; });
    assert.ok(drawn);
    // offline fonts, no service worker, no Node in the page
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.fonts.check('500 14px Inter')));
    assert.ok(await page.evaluate(async () => [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Inter' && f.status === 'loaded')));
    assert.equal(await page.evaluate(() => typeof require + typeof process), 'undefinedundefined');
    assert.equal(await page.evaluate(async () => { try { return (await navigator.serviceWorker.getRegistrations()).length; } catch (e) { return 0; } }), 0);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('menu Open Folder (native dialog), recent list, page Open button uses the dialog too', async () => {
  const ud = tmp('svpc-ud-');
  const { app, page, errors } = await launch(ud);
  try {
    await app.evaluate(({ dialog }, dir) => { global.__dialogCalls = 0; dialog.showOpenDialog = async () => { global.__dialogCalls++; return { canceled: false, filePaths: [dir] }; }; }, study2);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => /Open F&older/.test(i.label)).click());
    await waitSeries(page, 1);
    let s = await seriesInfo(page);
    assert.equal(s.find(x => x.desc === 'Chest axial').n, 7);
    const recent = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => /Recent/.test(i.label)).submenu.items.map(i => i.label));
    assert.ok(recent[0].includes('CD2'), recent.join('|'));
    const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
    assert.equal(saved.recent[0], study2);

    // the page's own "Open files" button goes through the native dialog (no browser file chooser)
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => { global.__dialogCalls++; return { canceled: false, filePaths: [dir] }; }; }, study1);
    let chooser = false; page.on('filechooser', () => { chooser = true; });
    await page.click('label.btn.primary.pick');
    await waitSeries(page, 2);
    s = await seriesInfo(page);
    assert.ok(s.some(x => x.desc === 'Head axial' && x.n === 12));
    assert.equal(chooser, false);
    assert.equal(await app.evaluate(() => global.__dialogCalls), 2);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('reports are saved through a native Save dialog', async () => {
  const ud = tmp('svpc-ud-'), out = path.join(tmp('svpc-out-'), 'report.pdf');
  const { app, page } = await launch(ud);
  try {
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async (w, o) => { global.__saveDefault = o.defaultPath; return { canceled: false, filePath: p }; }; }, out);
    const r = await page.evaluate(async () => { const dl = await window.claude.use('downloads'); return dl.save({ filename: 'CT report.pdf', data: new Uint8Array([37, 80, 68, 70, 45]) }); });
    assert.deepEqual(r, { saved: true });
    assert.equal(fs.readFileSync(out, 'latin1'), '%PDF-');
    assert.ok((await app.evaluate(() => global.__saveDefault)).endsWith('CT report.pdf'));
    // cancelling is reported the way the viewer expects
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    const code = await page.evaluate(async () => { try { await (await window.claude.use('downloads')).save({ filename: 'x.pdf', data: new Uint8Array(1) }); return 'saved'; } catch (e) { return e.code; } });
    assert.equal(code, 'declined');
    // the real report from the viewer: open a study, write the report, press PDF
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async (w, o) => { global.__saveDefault = o.defaultPath; return { canceled: false, filePath: p }; }; }, out);
    fs.rmSync(out);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, study1);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items[0].click());
    await waitSeries(page, 1);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.find(i => /Report/.test(i.label)).click());
    await page.waitForSelector('#r_findings', { state: 'visible' });
    await page.fill('#r_findings', 'No acute intracranial abnormality.');
    await page.click('#rPdf');
    await page.waitForFunction(() => /PDF saved/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
    const pdf = fs.readFileSync(out);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(pdf.length > 1000);
    assert.ok(path.basename(await app.evaluate(() => global.__saveDefault)).endsWith('.pdf'));
  } finally { await app.close(); }
});

test('security: no file access beyond what the user chose, no navigation away, links open in the browser', async () => {
  const ud = tmp('svpc-ud-');
  const { app, page } = await launch(ud);
  try {
    await app.evaluate(({ shell }) => { global.__ext = []; shell.openExternal = async u => { global.__ext.push(u); }; });
    const denied = await page.evaluate(() => window.sliceviewDesktop.readFile(424242).then(() => 'read', e => 'denied'));
    assert.equal(denied, 'denied');
    for (const p of ['../package.json', 'electron/main.js', '%2e%2e/package.json', 'node_modules/electron/package.json', 'sw.js']) {
      const st = await page.evaluate(u => fetch('sliceview://app/' + u).then(r => r.status, () => 'blocked'), p);
      assert.ok(st === 404 || st === 'blocked', p + ' -> ' + st);
    }
    assert.equal(await page.evaluate(() => fetch('sliceview://app/icon-192.png').then(r => r.status)), 200);
    await page.evaluate(() => window.open('https://example.org/help', '_blank'));
    await page.evaluate(() => { location.href = 'https://example.org/away'; });
    await page.waitForTimeout(500);
    assert.equal(page.url().replace(/^(sliceview:\/\/app)\/.*$/, '$1'), 'sliceview://app');
    const ext = await app.evaluate(() => global.__ext);
    assert.ok(ext.includes('https://example.org/help') && ext.includes('https://example.org/away'), ext.join(','));
    // file:// and other schemes are never opened
    await page.evaluate(() => window.open('file:///C:/Windows/System32/calc.exe'));
    await page.waitForTimeout(200);
    assert.ok(!(await app.evaluate(() => global.__ext)).some(u => u.startsWith('file:')));
  } finally { await app.close(); }
});

test('window size and position are kept between runs', async () => {
  const ud = tmp('svpc-ud-');
  let { app } = await launch(ud);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 30, width: 1111, height: 777 }));
  await new Promise(r => setTimeout(r, 300));
  await app.close();
  ({ app } = await launch(ud));
  try {
    const b = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.equal(b.width, 1111); assert.equal(b.height, 777);
  } finally { await app.close(); }
});
