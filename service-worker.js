/* Static shell cache only. API, OpenStreetMap tiles and photo links are not precached. */
const CACHE_NAME = 'pole-survey-app-copy-shell-v3';
const SHELL = [
  './', './index.html', './config.js', './offline-bridge.js', './leaflet-compat.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png'
];
const STATIC_CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-editable@1.3.2/src/Leaflet.Editable.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];
const STATIC_CDN_HOSTS = new Set(['unpkg.com', 'cdnjs.cloudflare.com']);
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await cache.addAll(SHELL);
    // Cache version-pinned libraries for the app shell; never prefetch or cache OSM map tiles here.
    await Promise.all(STATIC_CDN_ASSETS.map((url) => cache.add(url).catch((error) => {
      console.warn('Static library precache skipped:', url, error && error.message);
    })));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('pole-survey-app-copy-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (STATIC_CDN_HOSTS.has(url.hostname) && ['script', 'style'].includes(request.destination)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      try {
        const response = await fetch(request);
        if (response && response.ok && response.type !== 'opaque') cache.put(request, response.clone());
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/functions/v1/') || url.pathname.includes('/rest/v1/')) return;
  event.respondWith(fetch(request).then((response) => {
    if (response && response.ok && (request.mode === 'navigate' || /\.(html|js|webmanifest|png)$/.test(url.pathname))) {
      const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
