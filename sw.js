/* Service worker: tiene sul telefono i file dell'app, così si apre anche senza rete.
   Gli audio salvati con «Salva sul telefono» stanno in una cache a parte (coro-audio-v1)
   gestita direttamente dall'app. Lo script genera_catalogo.py aggiorna VERSIONE. */

const VERSIONE = '2026-11-27-2206';
const CACHE_APP = 'coro-app-' + VERSIONE;
const FILE_APP = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icone/icona-192.png',
  'icone/icona-512.png',
  'icone/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_APP).then(c => c.addAll(FILE_APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(nomi => Promise.all(nomi.filter(n => n.startsWith('coro-app-') && n !== CACHE_APP).map(n => caches.delete(n))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Audio, testi e catalogo li gestisce l'app (rete, poi copia salvata)
  if (url.pathname.includes('/brani/')) return;

  // File dell'app: prima la rete (così gli aggiornamenti arrivano subito),
  // se non c'è rete la copia salvata sul telefono.
  e.respondWith(
    caches.open(CACHE_APP).then(async c => {
      const chiave = e.request.mode === 'navigate' ? 'index.html' : e.request;
      try {
        const r = await fetch(e.request, { cache: 'no-cache' });
        if (r.ok) c.put(chiave, r.clone());
        return r;
      } catch {
        return (await c.match(chiave, { ignoreSearch: true })) || Response.error();
      }
    }));
});
