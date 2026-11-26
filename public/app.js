// Appli installable + notifications (espace artisan).
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  const box = document.getElementById('pwa');
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let deferred = null;
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
  const status = (t) => { const el = $('pwa-status'); if (el) el.textContent = t; };

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; show('pwa-install', true); });
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

  async function refresh() {
    if (!box) return;
    show('pwa-ios', isIos && !isStandalone);
    const canPush = 'PushManager' in window && 'Notification' in window;
    if (!canPush) { show('pwa-on', false); show('pwa-off', false); status(isIos ? "Sur iPhone, installez d'abord l'appli (ci-dessous), puis ouvrez-la depuis l'écran d'accueil pour activer les notifications." : "Ce navigateur ne gère pas les notifications."); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    show('pwa-on', !sub); show('pwa-off', !!sub); show('pwa-test', !!sub);
    status(sub ? '✅ Notifications activées sur cet appareil.' : Notification.permission === 'denied' ? 'Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.' : 'Notifications pas encore activées sur cet appareil.');
  }

  document.addEventListener('click', async (e) => {
    const id = e.target && e.target.id;
    if (id === 'pwa-install' && deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; show('pwa-install', false); }
    if (id === 'pwa-on') {
      try {
        if (await Notification.requestPermission() !== 'granted') return refresh();
        const reg = await navigator.serviceWorker.ready;
        const key = await (await fetch('/app/push/cle')).text();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
        await post('/app/push/abonner', sub.toJSON());
        await post('/app/push/test');
      } catch (err) { status("Impossible d'activer les notifications : " + err.message); return; }
      refresh();
    }
    if (id === 'pwa-off') {
      const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      if (sub) { await post('/app/push/desabonner', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      refresh();
    }
    if (id === 'pwa-test') { await post('/app/push/test'); status('Notification de test envoyée. Elle arrive en quelques secondes.'); }
  });
  refresh();
})();
