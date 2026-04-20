const CACHE = 'tabinihon-v144';
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
  if (e.request.url.includes('supabase')) return;

  const isHTML = e.request.destination === 'document' || e.request.url.endsWith('.html');

  e.respondWith(
    fetch(e.request, isHTML ? { cache: 'no-store' } : {})
      .then(res => {
        if (res && res.status === 200 && res.type !== 'opaque' && !isHTML) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => {
        return caches.match(e.request).then(cached => {
          if (cached) return cached;
          if (isHTML) return caches.match('/tabinihon/index.html');
        });
      })
  );
});
