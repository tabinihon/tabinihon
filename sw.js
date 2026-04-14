const CACHE = 'tabinihon-v136';
const ASSETS = [
  '/tabinihon/',
  '/tabinihon/index.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('googleapis') || e.request.url.includes('gviz')) return;

  e.respondWith(
    // 網路優先：先抓最新版本，失敗才用快取
    fetch(e.request).then(res => {
      if (res && res.status === 200 && res.type !== 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => {
      // 離線時才用快取
      return caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.destination === 'document') {
          return caches.match('/tabinihon/index.html');
        }
      });
    })
  );
});
