// Sliceview desktop bridge: runs in the page, after the viewer, only in the Windows app.
// It connects the viewer to the native side exposed by the preload script (window.sliceviewDesktop).
(() => {
  'use strict';
  const D = window.sliceviewDesktop;
  if (!D || !window.__sliceview) return;
  const $ = s => document.querySelector(s);
  document.documentElement.classList.add('desktop');

  let sayTimer = 0;
  function say(text, ms = 3000) {
    const el = $('#status'); if (!el) return;
    el.textContent = text; el.classList.remove('off');
    clearTimeout(sayTimer); if (ms) sayTimer = setTimeout(() => el.classList.add('off'), ms);
  }
  function loading(n, total) {
    const box = $('#loading'); if (!box) return;
    if (n == null) { box.hidden = true; return; }
    box.hidden = false;
    $('#loadTxt').textContent = 'Reading files · ' + n + ' / ' + total;
    $('#loadBar').style.width = (total ? Math.min(100, n / total * 100) : 0) + '%';
  }

  // Files chosen in Windows (menu, dialog, Explorer "Open with", a .dcm double-click, recent list).
  // They are read through the main process, by id, then handed to the viewer as ordinary File objects,
  // exactly like files picked in a browser, so everything after this point is the same code.
  let busy = Promise.resolve();
  D.onOpenFiles(msg => { busy = busy.then(() => openList(msg)).catch(err => say('Could not open: ' + (err && err.message || err), 8000)); });
  async function openList({ files, truncated }) {
    const out = new Array(files.length), bad = [];
    let next = 0, n = 0, last = 0;
    loading(0, files.length);
    const worker = async () => {
      while (next < files.length) {
        const i = next++, f = files[i];
        try { const data = await D.readFile(f.id); out[i] = new File([data], f.name, { type: 'application/dicom' }); }
        catch (err) { bad.push(f.name); }
        n++;
        const now = Date.now(); if (now - last > 60) { last = now; loading(n, files.length); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
    D.release(files.map(f => f.id));
    loading(null);
    const list = out.filter(Boolean);
    if (!list.length) { say('None of the files could be read', 8000); return; }
    await window.__sliceview.addFiles(list);
    if (truncated) say('Only the first ' + list.length + ' files were opened', 8000);
    else if (bad.length) say(bad.length + ' file' + (bad.length === 1 ? '' : 's') + ' could not be read', 6000);
  }

  // The page's own Open buttons use the native dialogs too (DICOM filters, last folder, recent list).
  const inputs = { inFiles: 'files', inFolder: 'folder', inFolder2: 'folder' };
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'file' || !(t.id in inputs)) return;
    e.preventDefault(); e.stopPropagation();
    const more = $('#sheetMore'); if (more) more.hidden = true;
    D.openDialog(inputs[t.id]);
  }, true);

  // Menu commands that press a button in the page.
  D.onClick(sel => {
    const b = document.querySelector(sel);
    if (!b) return;
    if (b.disabled) { say('Not available right now', 3000); return; }
    b.click(); // also for buttons the layout hides (the report button lives in the ⋯ menu in the web version)
  });
  D.onMessage(m => say(m.text, m.ms));

  // Saving: the viewer supports a host "downloads" service (used for its PDF reports). On Windows it is a
  // native Save dialog; cancelling is reported as "declined", which the viewer understands.
  const declined = () => Object.assign(new Error('Not saved'), { code: 'declined' });
  window.claude = Object.freeze({
    use: async name => {
      if (name !== 'downloads') throw new Error('Not available');
      return Object.freeze({
        save: async ({ filename, data }) => {
          let bytes = data;
          if (bytes instanceof Blob) bytes = new Uint8Array(await bytes.arrayBuffer());
          else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
          else if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
          const r = await D.saveFile(filename, bytes);
          if (!r || !r.saved) throw declined();
          return { saved: true };
        },
      });
    },
  });

  // Things that only make sense in the Android / browser versions.
  const css = document.createElement('style');
  css.textContent = '.desktop #btnProMore{display:none!important}';
  document.head.append(css);

  D.ready();
})();
