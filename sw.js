const CACHE = 'tabinihon-v1';
const ASSETS = [
  '/tabinihon/',
  '/tabinihon/index.html',
];

// 安裝：快取核心檔案
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 啟動：清除舊快取
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 攔截請求：有快取用快取，沒有就抓網路
self.addEventListener('fetch', e => {
  // 只處理 GET 請求
  if (e.request.method !== 'GET') return;
  // Google Sheets API 不快取（要拿最新資料）
  if (e.request.url.includes('googleapis') || e.request.url.includes('gviz')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // 成功的請求存入快取
        if (res && res.status === 200 && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => {
        // 完全離線時，回傳主頁面
        if (e.request.destination === 'document') {
          return caches.match('/tabinihon/index.html');
        }
      });
    })
  );
});
