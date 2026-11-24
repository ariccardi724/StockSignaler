// Service worker: cache the app shell so the app opens standalone / offline.
// Live price data is never cached — it is always fetched fresh.
const CACHE = 'buy-signals-generic-v3';
const SHELL = ['./index.html', './styles.css', './app.js', './manifest.json', './icon.svg', './watchlist.json'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never cache Yahoo / proxy data calls.
  if (url.hostname.includes('yahoo') || url.hostname.includes('allorigins') || url.hostname.includes('corsproxy')) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
