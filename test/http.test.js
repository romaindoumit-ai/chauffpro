// Tests « de bout en bout » : on lance vraiment le serveur et on ouvre les pages.
process.removeAllListeners('warning');
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { ensureAdmin } = require('../src/auth');

async function boot() {
  process.env.ADMIN_EMAIL = 'admin@test.be';
  process.env.ADMIN_PASSWORD = 'admin-secret';
  const db = openDb(':memory:');
  ensureAdmin(db);
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  // Petit client qui garde le cookie de session
  let cookie = '';
  const req = async (path, { method = 'GET', form, json, headers = {} } = {}) => {
    const h = { ...headers, cookie };
    let body;
    if (form) { body = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['content-type'] = 'application/json'; }
    const r = await fetch(base + path, { method, body, headers: h, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, location: r.headers.get('location'), text: await r.text(), headers: r.headers };
  };
  const login = (email, password) => req('/connexion', { method: 'POST', form: { email, password } });
  return { db, server, req, login, base, resetCookie: () => { cookie = ''; } };
}

test('parcours complet : admin crée un artisan belge, un client remplit le formulaire', async (t) => {
  const s = await boot();
  t.after(() => s.server.close());
  let r = await s.login('admin@test.be', 'admin-secret');
  assert.equal(r.location, '/admin');
  r = await s.req('/admin');
  assert.match(r.text, /Ajouter un artisan/);
  r = await s.req('/admin/comptes', { method: 'POST', form: { company_name: 'Chauffage Dubois', email: 'dubois@test.be', phone: '0470 11 22 33', country: 'BE' } });
  const pw = new URL(r.location, s.base).searchParams.get('pw');
  assert.ok(pw);
  const acc = s.db.prepare("SELECT * FROM accounts WHERE email='dubois@test.be'").get();
  assert.equal(acc.country, 'BE');
  assert.equal(acc.phone, '+32470112233');

  s.resetCookie();
  r = await s.req('/f/chauffage-dubois');
  assert.equal(r.status, 200);
  assert.match(r.text, /0470 12 34 56/);
  r = await s.req('/f/chauffage-dubois', { method: 'POST', form: { work_type: 'Remplacement de chaudière', first_name: 'Lotte', phone: '0478 12 34 56', postal_code: '1050', consent: '1' } });
  assert.equal(r.status, 302);
  const lead = s.db.prepare('SELECT * FROM leads').get();
  assert.equal(lead.phone, '+32478123456');

  r = await s.req('/s/chauffage-dubois/confidentialite');
  assert.match(r.text, /Autorité de protection des données/);

  r = await s.login('dubois@test.be', pw);
  assert.equal(r.location, '/app');
  for (const p of ['/app', '/app/demandes', `/app/demandes/${lead.id}`, '/app/messages', '/app/rapport', '/app/integration', '/app/reglages']) {
    r = await s.req(p);
    assert.equal(r.status, 200, p);
  }
  assert.match((await s.req('/app/reglages')).text, /N° d'entreprise \(BCE\)/);
});

test('démo en ligne : un compte fictif par visiteur, rien de réel envoyé, effacé après 24 h', async (t) => {
  const s = await boot();
  t.after(() => s.server.close());
  let r = await s.req('/demo');
  assert.match(r.text, /Ouvrir la démo/);
  r = await s.req('/demo', { method: 'POST' });
  assert.equal(r.location, '/app');
  r = await s.req('/app');
  assert.match(r.text, /Compte de démonstration/);
  assert.match(r.text, /Julie Lefèvre/);
  const a = s.db.prepare('SELECT * FROM accounts WHERE is_demo=1').get();
  assert.ok(s.db.prepare("SELECT COUNT(*) n FROM leads WHERE account_id=?").get(a.id).n >= 8);
  // Même avec une vraie clé Brevo, un compte démo n'envoie rien.
  process.env.BREVO_API_KEY = 'fausse-cle';
  try {
    const E = require('../src/engine');
    const lead = s.db.prepare("SELECT * FROM leads WHERE account_id=? AND status='nouveau'").get(a.id);
    const id = E.schedule(s.db, a, lead, 'confirmation', 'sms', new Date(), { respectWindow: false });
    await E.processDue(s.db);
    assert.equal(s.db.prepare('SELECT status FROM messages WHERE id=?').get(id).status, 'simule');
  } finally { delete process.env.BREVO_API_KEY; }
  // 2 jours plus tard, le compte a été effacé
  await require('../src/engine').processDue(s.db, new Date(Date.now() + 2 * 86400000));
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM accounts WHERE is_demo=1').get().n, 0);
  // Les démos n'apparaissent pas dans l'administration
  await s.login('admin@test.be', 'admin-secret');
  assert.doesNotMatch((await s.req('/admin')).text, /Dupont Chauffage/);
});

test("ancien client ajouté à la main -> rappel d'entretien ; il reprend RDV -> nouvelle fiche", async (t) => {
  const s = await boot();
  t.after(() => s.server.close());
  await s.login('admin@test.be', 'admin-secret');
  let r = await s.req('/admin/comptes', { method: 'POST', form: { company_name: 'Chauffage Dubois', email: 'dubois@test.be', country: 'BE' } });
  const pw = new URL(r.location, s.base).searchParams.get('pw');
  await s.login('dubois@test.be', pw);
  r = await s.req('/app/demandes', { method: 'POST', form: { first_name: 'Jan', phone: '0478 11 22 33', work_type: 'Remplacement de chaudière', last_service: '2025-12-10', consent: '1' } });
  assert.match(decodeURIComponent(r.location), /rappel d'entretien est programmé/);
  const lead = s.db.prepare('SELECT * FROM leads').get();
  assert.equal(lead.status, 'termine');
  const m = s.db.prepare("SELECT * FROM messages WHERE kind='entretien'").get();
  assert.ok(m.scheduled_at >= '2026-12-10');
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM messages WHERE kind LIKE 'avis%'").get().n, 0);
  // Le client clique sur le lien du SMS et choisit un créneau
  s.resetCookie();
  r = await s.req(`/rdv/chauffage-dubois?l=${lead.token}`);
  assert.match(r.text, /<option selected>Entretien ou dépannage chaudière/);
  await s.req('/rdv/chauffage-dubois', { method: 'POST', form: { l: lead.token, work_type: 'Entretien ou dépannage chaudière', first_name: 'Jan', phone: '0478112233', city: '1000', day: 'lundi', slot: 'Matin (8h-12h)', consent: '1' } });
  const leads = s.db.prepare('SELECT * FROM leads ORDER BY id').all();
  assert.equal(leads.length, 2);
  assert.equal(leads[0].work_type, 'Remplacement de chaudière');
  assert.equal(leads[1].source, 'rdv');
});

test('appli installable + notification envoyée au téléphone à chaque nouvelle demande', async (t) => {
  const webpush = require('web-push');
  const sent = [];
  const orig = webpush.sendNotification;
  webpush.sendNotification = async (sub, payload) => { sent.push({ sub, payload: JSON.parse(payload) }); return {}; };
  t.after(() => { webpush.sendNotification = orig; });
  const s = await boot();
  t.after(() => s.server.close());
  assert.equal((await s.req('/manifest.webmanifest')).status, 200);
  assert.equal((await s.req('/sw.js')).status, 200);
  await s.login('admin@test.be', 'admin-secret');
  let r = await s.req('/admin/comptes', { method: 'POST', form: { company_name: 'Chauffage Dubois', email: 'dubois@test.be', country: 'BE' } });
  await s.login('dubois@test.be', new URL(r.location, s.base).searchParams.get('pw'));
  r = await s.req('/app/appli');
  assert.match(r.text, /Activer les notifications/);
  assert.match(r.text, /manifest\.webmanifest/);
  const key = (await s.req('/app/push/cle')).text;
  assert.ok(key.length > 60);
  assert.equal((await s.req('/app/push/cle')).text, key); // clé stable
  r = await s.req('/app/push/abonner', { method: 'POST', json: { endpoint: 'http://pas-https', keys: { p256dh: 'a', auth: 'b' } }, headers: { origin: s.base } });
  assert.equal(JSON.parse(r.text).ok, false);
  r = await s.req('/app/push/abonner', { method: 'POST', json: { endpoint: 'https://push.exemple/abc', keys: { p256dh: 'cle', auth: 'auth' } }, headers: { origin: s.base } });
  assert.equal(JSON.parse(r.text).ok, true);
  s.resetCookie();
  await s.req('/f/chauffage-dubois', { method: 'POST', form: { work_type: 'Remplacement de chaudière', first_name: 'Lotte', phone: '0478 12 34 56', postal_code: '1050', consent: '1' } });
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.title, /Nouvelle demande : Lotte/);
  assert.match(sent[0].payload.url, /^\/app\/demandes\/\d+$/);
});

test('le client réserve un créneau de visite dans le formulaire ; le créneau disparaît ; rappel la veille', async (t) => {
  const s = await boot();
  t.after(() => s.server.close());
  await s.login('admin@test.be', 'admin-secret');
  let r = await s.req('/admin/comptes', { method: 'POST', form: { company_name: 'Chauffage Dubois', email: 'dubois@test.be', country: 'BE' } });
  const pw = new URL(r.location, s.base).searchParams.get('pw');
  s.resetCookie();
  r = await s.req('/f/chauffage-dubois');
  assert.match(r.text, /Choisissez un créneau pour la visite/);
  const slots = [...r.text.matchAll(/name="visit" value="([^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  assert.ok(slots.length >= 8, `${slots.length} créneaux`);
  const pick = slots[3];
  const form = { work_type: 'Remplacement de chaudière', first_name: 'Lotte', phone: '0478 12 34 56', email: 'lotte@x.be', postal_code: '1050', consent: '1', visit: pick };
  r = await s.req('/f/chauffage-dubois', { method: 'POST', form });
  assert.equal(r.status, 302);
  const lead = s.db.prepare('SELECT * FROM leads').get();
  assert.equal(lead.status, 'rdv');
  assert.equal(lead.visit_at, pick);
  r = await s.req(r.location);
  assert.match(r.text, /Votre visite est réservée/);
  const m = s.db.prepare('SELECT kind, channel, body FROM messages WHERE lead_id=?').all(lead.id);
  assert.ok(m.some((x) => x.kind === 'visite' && x.channel === 'sms' && /passera chez vous/.test(x.body)));
  assert.ok(m.some((x) => x.kind === 'notif' && /Visite réservée/.test(x.body)));
  // Le créneau n'est plus proposé, et une 2e réservation du même créneau est refusée
  assert.doesNotMatch((await s.req('/f/chauffage-dubois')).text, new RegExp(`value="${pick}"`));
  r = await s.req('/f/chauffage-dubois', { method: 'POST', form: { ...form, first_name: 'Jan', phone: '0479 00 00 00' } });
  assert.equal(r.status, 400);
  assert.match(r.text, /vient d(&#39;|')être réservé/);
  // L'artisan voit la visite et peut la déplacer
  await s.login('dubois@test.be', pw);
  r = await s.req(`/app/demandes/${lead.id}`);
  assert.match(r.text, /calendar\.google\.com/);
  r = await s.req(`/app/demandes/${lead.id}/visite`, { method: 'POST', form: { visit: slots[6] } });
  assert.match(decodeURIComponent(r.location), /Visite enregistrée/);
  assert.equal(s.db.prepare('SELECT visit_at FROM leads').get().visit_at, slots[6]);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM messages WHERE kind='rappel_visite' AND status='en_attente'").get().n <= 1, true);
  assert.match((await s.req('/app')).text, /Prochaines visites/);
});
