// Offline support.
// Online: always load the latest files (revalidated with GitHub, so an unchanged file costs
// a tiny "not modified" answer). Offline or very slow network: fall back to the saved copy.
// The app itself checks js/version.js to notice new releases (see checkForUpdate in app.js).
const CACHE = 'adventure-deck';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/version.js', './js/config.js', './js/rules.js', './js/store.js', './js/tools.js', './js/live.js', './js/weather.js', './js/cod.js', './js/data/cod.js',
  './js/data/cards.js', './js/data/places.js', './js/data/lists.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];
const NETWORK_TIMEOUT = 3500; // ms before we give up on the network and use the saved copy

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so we never save stale files.
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
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
  if (url.searchParams.has('check')) return;                          // version checks always hit the network
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch { /* offline */ }
  const cached = await cache.match(req, { ignoreSearch: true })
    || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
  if (cached) return cached;
  return network.catch(() => Response.error()); // nothing saved: keep waiting for the network
}
