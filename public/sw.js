// Service worker ChauffPro : rend l'appli installable et affiche les notifications.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Hors connexion : petite page d'explication au lieu de l'écran d'erreur du navigateur.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Pas de connexion</h1><p>Vérifiez votre réseau puis réessayez.</p><button onclick="location.reload()" style="padding:12px 20px;font-size:16px">Réessayer</button></body>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: 'ChauffPro', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ChauffPro', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/app' }, tag: d.url || undefined,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/app', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
