// Earth Sentinel — Service Worker
// Estratégia: cache-first para shell estático; network-only para APIs ao vivo

const CACHE_NAME = 'earth-sentinel-v18';

// Precache enxuto do shell essencial. Os módulos de tema (shared/, themes/) são
// cacheados em runtime no primeiro fetch — manter a lista mínima evita que o
// install do SW quebre se um módulo for renomeado.
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/base.css',
  '/css/layout.css',
  '/css/panels.css',
  '/css/loader.css',
  '/css/risk-panel.css',
  '/css/components.css',
  '/css/themes/extreme-events.css',
  '/fonts/inter-400.woff2',
  '/fonts/inter-600.woff2',
  '/fonts/space-grotesk-700.woff2',
  '/fonts/jetbrains-mono-600.woff2',
  '/fonts/ibm-plex-mono-500.woff2',
  '/js/app.js',
  '/js/map.js',
  '/js/globe.js',
  '/js/events.js',
  '/js/notifications.js',
];

// Padrões que devem sempre ir à rede (dados ao vivo)
const NETWORK_PATTERNS = [
  /^https:\/\/services\.swpc\.noaa\.gov\//,
  /^https:\/\/earthquake\.usgs\.gov\//,
  /^https:\/\/eonet\.gsfc\.nasa\.gov\//,
  /^https:\/\/api\.open-meteo\.com\//,
  /^https:\/\/air-quality-api\.open-meteo\.com\//,
  /^https:\/\/www\.gdacs\.org\//,
  /^https:\/\/gibs\.earthdata\.nasa\.gov\//,
  /\/api\/gdacs\//,
  /\/api\/google\//,
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Ignora requests não-GET
  if (request.method !== 'GET') return;

  // Dados ao vivo → sempre rede
  const url = request.url;
  if (NETWORK_PATTERNS.some(p => p.test(url))) {
    event.respondWith(fetch(request));
    return;
  }

  // CDN (Three.js, TopoJSON, Font Awesome, Material Symbols) → rede com fallback de cache
  if (url.includes('cdnjs.cloudflare.com') || url.includes('cdn.jsdelivr.net') ||
      url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Shell estático → network-first com fallback de cache.
  // Garante código fresco em dev/prod quando online; offline cai para o cache.
  // Sempre resolve para uma Response (nunca rejeita) — evita "network error" no SW.
  event.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request).then(cached => {
        if (cached) return cached;
        // Navegações offline caem para o index.html em cache (SPA).
        if (request.mode === 'navigate') return caches.match('/index.html');
        return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
      }))
  );
});
