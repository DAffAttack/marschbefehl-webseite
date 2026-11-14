// Offline-Speicher für die Einlass-Seite (14.11.2026). Gilt nur für /einlass*.
// Seite: erst Netz, sonst Zwischenspeicher. Scanner-Bibliothek: Zwischenspeicher zuerst.
// Gästedaten liegen NICHT hier, sondern im localStorage der Seite.
var CACHE = 'einlass-v1';
var DATEIEN = ['/einlass.html', '/assets/einlass/jsQR.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(DATEIEN); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('einlass-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.indexOf('/.netlify/') === 0) return; // Daten nie zwischenspeichern
  if (e.request.mode === 'navigate' && (url.pathname === '/einlass' || url.pathname === '/einlass.html')) {
    e.respondWith(fetch(e.request).then(function (r) {
      if (r.ok) { var kopie = r.clone(); caches.open(CACHE).then(function (c) { c.put('/einlass.html', kopie); }); }
      return r;
    }).catch(function () { return caches.match('/einlass.html'); }));
    return;
  }
  if (url.pathname === '/assets/einlass/jsQR.js') {
    e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
  }
});
