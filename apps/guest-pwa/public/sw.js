// Service worker del Modo Invitado (se registra solo en producción).
// Cachea el shell de la app para que abra aunque la red esté saturada (temporada alta en Av. Chiozza,
// Calle 2…). La API y las teselas del mapa NO se cachean: precios y estados siempre vienen en vivo.
const CACHE = 'lcv-guest-v1';
const SHELL = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API, teselas, Mercado Pago: siempre red

  // Navegación: red primero, y si falla, el shell cacheado.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  // Estáticos de Next (con hash en el nombre): caché primero.
  if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
