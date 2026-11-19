/* The production build injects the cache version and asset paths above this line. */
const cachePrefix = `skybreak:${self.registration.scope}:`;
const cacheName = cachePrefix + VERSION;
const urls = ASSETS.map(path => new URL(path, self.registration.scope).href);
const shell = new URL('index.html', self.registration.scope);
const root = new URL(self.registration.scope);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName)
    .then(cache => cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const navigation = request.mode === 'navigate' && url.origin === root.origin &&
    (url.pathname === root.pathname || url.pathname === shell.pathname);
  const key = navigation ? shell.href : request.url;
  if (!urls.includes(key)) return;
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(key)) ?? fetch(request)));
});
