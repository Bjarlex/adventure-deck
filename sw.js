// Offline support. Serves the app from cache instantly, and refreshes the cache in the
// background, so a new version pushed to GitHub shows up on the next launch.
// Bump CACHE when you change the list of files.
const CACHE = 'adventure-deck-v2.2.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/rules.js', './js/store.js', './js/tools.js', './js/live.js',
  './js/data/cards.js', './js/data/places.js', './js/data/lists.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // sync API and weather go straight to the network
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }));
});
