// Builds the Windows icon (build/icon.ico, 16-256 px) and build/icon.png from the app's 512 px icon.
import pngToIco from 'png-to-ico';
import fs from 'node:fs';
const src = new URL('../icon-512.png', import.meta.url);
const out = new URL('../build/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(src, new URL('icon.png', out));
fs.writeFileSync(new URL('icon.ico', out), await pngToIco(src.pathname));
console.log('build/icon.ico written');
