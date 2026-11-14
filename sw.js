// SlipCheck service worker — the app opens with no signal.
// Same-origin files: served from cache at once, refreshed in the background.
const CACHE = 'slipcheck-v24';
const SDK = 'https://www.gstatic.com/firebasejs/13.2.0/';
const SHELL = [
  './', 'index.html', 'style.css', 'main.js', 'reconcile.js', 'extract.js', 'history.js', 'orient.js', 'ledger.js', 'speak.js', 'voice.js', 'voice/clips.json', 'i18n.js',
  'firebase.js', 'firebase-config.js', 'explain-prompt.js',
  SDK + 'firebase-app.js', SDK + 'firebase-app-check.js', SDK + 'firebase-ai.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'samples/slip_ko_mismatch.png', 'samples/slip_en.png', 'samples/slip_es.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin && !url.href.startsWith(SDK)) return; // API calls go straight to network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => {
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    try { return await net; }
    catch (_) { return (await cache.match('index.html')) || Response.error(); }
  })());
});
