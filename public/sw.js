// Mountain Made PWA Service Worker
const CACHE_NAME = 'mountain-made-v1';

self.addEventListener('install', (event) => {
  console.log('Service Worker installing.');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating.');
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Let network handle all requests (fully dynamic)
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response('Offline - Please check your connection', {
        headers: { 'Content-Type': 'text/plain' }
      });
    })
  );
});
