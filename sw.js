// Sliceview service worker, version 2026.11.21-0017
// The app opens from the network when online (so updates arrive on their own) and from this cache offline.
const CACHE = 'slvpc-2026.11.21-0017';
const FILES = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "favicon-32.png"];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('slvpc-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin) return; // fonts and the like: straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await Promise.race([fetch(req, { cache: 'no-cache' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 4000))]);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
