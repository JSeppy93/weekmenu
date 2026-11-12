// Service worker: zorgt dat de app offline werkt (bijv. in de winkel zonder bereik).
// Verhoog VERSION bij elke wijziging, dan haalt de app de nieuwe bestanden op.
const VERSION = 'weekmenu-v5';
const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './recipes.js',
  './manifest.webmanifest',
  './keuken.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netwerk eerst (zodat updates direct binnenkomen), cache als terugval als er geen bereik is.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    // 'no-cache': altijd bij de server navragen of het bestand gewijzigd is, zodat updates direct zichtbaar zijn.
    fetch(req.url, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
