/* Service worker: guarda la app para que abra rápido y sin conexión. Los datos siempre vienen del backend. */
var VERSION = 'gastos-v4';
var ARCHIVOS = ['./', 'index.html', 'css/app.css', 'js/config.js', 'js/logica.js', 'js/iconos.js', 'js/api.js', 'js/app.js',
  'manifest.webmanifest', 'icons/icono-192.png', 'icons/icono-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Archivos propios: primero la red (para tomar actualizaciones), si no hay conexión, la copia guardada.
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var copia = r.clone();
    caches.open(VERSION).then(function (c) { c.put(e.request, copia); });
    return r;
  }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('index.html'); }); }));
});
