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
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept API calls or non-GET requests (POST uploads, PUT, DELETE, etc.)
  // so network/backend errors are returned as-is.
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  // For navigations/documents, provide an offline-friendly fallback text.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response('Offline - Please check your connection', {
          headers: { 'Content-Type': 'text/plain' }
        });
      })
    );
    return;
  }

  // Static assets: network-first, but do not replace errors with custom text.
  event.respondWith(fetch(request));
});
