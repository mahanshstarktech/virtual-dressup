// Drape PWA — Service Worker
const CACHE_NAME = 'drape-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/wardrobe.js',
  '/js/capture.js',
  '/js/tryon.js',
  '/js/utils.js',
  '/manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for CDN resources, cache-first for local assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin CDN requests (MediaPipe, etc.)
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((response) => {
        // Update cache with fresh response
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});

// Background sync (future: sync wardrobe to cloud)
self.addEventListener('sync', (event) => {
  if (event.tag === 'wardrobe-sync') {
    event.waitUntil(syncWardrobe());
  }
});

async function syncWardrobe() {
  // Placeholder for future cloud sync
  console.log('[SW] Wardrobe sync triggered');
}
