/* Smart POS GitHub Pages offline shell. Never cache Supabase API/auth responses. */
const CACHE_PREFIX = 'smart-pos-start-v2';
const SHELL_CACHE = `${CACHE_PREFIX}-shell`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime`;
const BASE_URL = new URL('./', self.registration.scope).href;
const SHELL_URLS = [
  BASE_URL,
  new URL('index.html', BASE_URL).href,
  new URL('manifest.webmanifest', BASE_URL).href,
  new URL('icon.svg', BASE_URL).href
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Cache each local shell asset independently so one missing optional asset does not block install.
    await Promise.all(SHELL_URLS.map(async url => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.ok) await cache.put(url, response);
      } catch (_) { /* Offline first install cannot populate missing assets. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('smart-pos-start-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Exclude Supabase API, authentication, and storage. Never serve cached business data as server truth.
  if (/\.supabase\.co$/i.test(url.hostname) || /\/(rest\/v1|auth\/v1|storage\/v1)\//.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      } catch (_) {
        return (await cache.match(request)) || (await cache.match(BASE_URL)) || (await cache.match(new URL('index.html', BASE_URL).href)) || Response.error();
      }
    })());
    return;
  }

  // Same-origin static assets and libraries already requested once may be used offline.
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone()).catch(() => {});
      return response;
    } catch (_) {
      return (await cache.match(request)) || (await caches.open(SHELL_CACHE).then(c => c.match(request))) || Response.error();
    }
  })());
});
