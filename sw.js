// Service worker: funciona sin conexión y recibe las notificaciones push.
const VERSION = 'la-v2';
const SHELL = [
  '/', '/index.html', '/css/styles.css', '/js/app.js', '/js/i18n.js', '/js/schedule.js', '/js/config.js', '/js/doctor.js',
  '/manifest.webmanifest', '/icons/doctor.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-72.png',
];

self.addEventListener('install', (e) => {
  // Cachea cada archivo por separado: si falta alguno, el resto sigue funcionando.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Red primero para nuestros archivos (así siempre ves la última versión), caché si no hay conexión.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Last Asylum', body: e.data?.text() }; }
  const title = data.title || 'Last Asylum';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: data.tag,
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    vibrate: [200, 100, 200, 100, 300],
    data: { url: data.url || '/#/home' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/#/home';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        c.postMessage({ type: 'navigate', url: target });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
