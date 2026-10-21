// Cache per funzionare anche senza rete. Cambia VERSION a ogni aggiornamento.
const VERSION = 'tc-46';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'icon.svg', 'logo.png', 'logo-dark.png', 'manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Rete prima, cache se offline: così gli aggiornamenti arrivano subito.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // no-cache: chiede sempre al server se c'è una versione nuova (GitHub tiene i file in cache 10 minuti).
    // Anche la pagina principale: altrimenti Safari la tiene in memoria e non vede gli aggiornamenti.
    fetch(e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      : new Request(e.request, { cache: 'no-cache' })).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
