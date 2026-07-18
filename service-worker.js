const CACHE='vmms-variatie-4.1.0-drive-fotoarchief-20260718';
const CORE=[
  './',
  'index.html',
  'styles.css?v=4.1.0-drive-fotoarchief-20260718',
  'seed-data.js?v=4.1.0-drive-fotoarchief-20260718',
  'drive-config.js?v=4.1.0-drive-fotoarchief-20260718',
  'restoration-data.js?v=4.1.0-drive-fotoarchief-20260718',
  'photo-library-data.js?v=4.1.0-drive-fotoarchief-20260718',
  'inspiration-data.js?v=4.1.0-drive-fotoarchief-20260718',
  'paint-restoration-data.js?v=4.1.0-drive-fotoarchief-20260718',
  'mayday-maintenance-data.js?v=4.1.0-drive-fotoarchief-20260718',
  'app.js?v=4.1.0-drive-fotoarchief-20260718',
  'manifest.json?v=4.1.0-drive-fotoarchief-20260718',
  'vmms-logo-192.png','vmms-logo-512.png','vmms-logo-full.png','restauratieplan.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, {cache:'no-store'});
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || (await cache.match('index.html'));
  }
}

async function imageCache(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || refresh || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const destination = request.destination;
  const isCode = ['document','script','style','manifest'].includes(destination)
    || /\.(?:html|js|css|json)$/i.test(url.pathname);

  if (isCode || request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (destination === 'image' || /\.(?:png|jpe?g|svg|webp)$/i.test(url.pathname)) {
    event.respondWith(imageCache(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus' in client)return client.focus()}return clients.openWindow('./')}));
});
