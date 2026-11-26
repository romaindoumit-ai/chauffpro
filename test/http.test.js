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
  assert.match(r.text, /value="Entretien ou dépannage chaudière" selected/);
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

test("assistant IA : invisible sans clé, résumé et brouillons avec clé, limite par jour", async (t) => {
  const AI = require('../src/ai');
  const s = await boot();
  t.after(() => { s.server.close(); AI._client = null; });
  await s.login('admin@test.be', 'admin-secret');
  let r = await s.req('/admin/comptes', { method: 'POST', form: { company_name: 'Chauffage Dubois', email: 'dubois@test.be', country: 'BE' } });
  const pw = new URL(r.location, s.base).searchParams.get('pw');
  s.resetCookie();
  await s.req('/f/chauffage-dubois', { method: 'POST', form: { work_type: 'Remplacement de chaudière', first_name: 'Lotte', phone: '0478 12 34 56', email: 'lotte@x.be', postal_code: '1050', consent: '1', message: 'Ma chaudière Vaillant fait du bruit' } });
  const lead = s.db.prepare('SELECT * FROM leads').get();
  await s.login('dubois@test.be', pw);
  r = await s.req(`/app/demandes/${lead.id}`);
  assert.doesNotMatch(r.text, /Assistant IA/); // pas de clé : rien ne s'affiche
  // Avec une clé (client simulé)
  const calls = [];
  AI._client = { beta: { messages: { create: async (p) => { calls.push(p); return { stop_reason: 'end_turn', content: [{ type: 'text', text: '• Remplacement de chaudière, normal\n• À vérifier : modèle exact' }] }; } } } };
  r = await s.req(`/app/demandes/${lead.id}`);
  assert.match(r.text, /Assistant IA/);
  await s.req(`/app/demandes/${lead.id}/ia/resume`, { method: 'POST', form: {} });
  assert.match(s.db.prepare('SELECT ai_summary FROM leads').get().ai_summary, /chaudière/);
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.match(calls[0].messages[0].content, /Vaillant/);
  assert.match(calls[0].messages[0].content, /<client>/);
  await s.req(`/app/demandes/${lead.id}/ia/reponse`, { method: 'POST', form: { channel: 'sms', instruction: 'proposer jeudi matin' } });
  assert.match(calls[1].messages[0].content, /proposer jeudi matin/);
  r = await s.req('/app/avis-google', { method: 'POST', form: { stars: '2', review: 'Arrivé en retard' } });
  assert.match(r.text, /Réponse proposée/);
  assert.match(calls[2].messages[0].content, /2 étoile/);
  // Refus du modèle -> message clair, pas de plantage
  AI._client.beta.messages.create = async () => ({ stop_reason: 'refusal', content: [] });
  r = await s.req(`/app/demandes/${lead.id}/ia/resume`, { method: 'POST', form: {} });
  assert.match(decodeURIComponent(r.location), /err=L'assistant IA n'a pas pu/);
  // Limite quotidienne
  process.env.AI_DAILY_LIMIT = '4';
  try {
    r = await s.req(`/app/demandes/${lead.id}/ia/resume`, { method: 'POST', form: {} });
    assert.match(decodeURIComponent(r.location), /Limite de 4/);
  } finally { delete process.env.AI_DAILY_LIMIT; }
});

test('formulaire en néerlandais : page, données en français pour l\'artisan, messages au client en néerlandais', async (t) => {
  const s = await boot();
  t.after(() => s.server.close());
  await s.login('admin@test.be', 'admin-secret');
  await s.req('/admin/comptes', { method: 'POST', form: { company_name: 'Chauffage Dubois', email: 'dubois@test.be', country: 'BE' } });
  s.resetCookie();
  let r = await s.req('/f/chauffage-dubois?lang=nl');
  assert.match(r.text, /<html lang="nl">/);
  assert.match(r.text, /Gratis offerte aanvragen/);
  assert.match(r.text, /Vervanging verwarmingsketel/);
  assert.match(r.text, /Kies een tijdslot/);
  // Détection automatique via la langue du téléphone
  r = await s.req('/f/chauffage-dubois', { headers: { 'accept-language': 'nl-BE,nl;q=0.9' } });
  assert.match(r.text, /Gratis offerte aanvragen/);
  assert.match((await s.req('/f/chauffage-dubois')).text, /Demande de devis gratuit/);
  // Erreur affichée en néerlandais
  r = await s.req('/f/chauffage-dubois', { method: 'POST', form: { lang: 'nl', work_type: 'Remplacement de chaudière', first_name: 'Jan', phone: '123', postal_code: '1000', consent: '1' } });
  assert.match(r.text, /telefoonnummer lijkt niet correct/);
  r = await s.req('/f/chauffage-dubois', { method: 'POST', form: { lang: 'nl', work_type: 'Remplacement de chaudière', housing: 'Maison', energy: 'Mazout / fioul', first_name: 'Jan', phone: '0478 12 34 56', email: 'jan@x.be', postal_code: '1000', consent: '1' } });
  assert.match(r.location, /lang=nl/);
  assert.match((await s.req(r.location)).text, /Aanvraag verstuurd/);
  const lead = s.db.prepare('SELECT * FROM leads').get();
  assert.equal(lead.lang, 'nl');
  assert.equal(lead.work_type, 'Remplacement de chaudière'); // l'artisan lit en français
  assert.match(lead.message, /Mazout/);
  const sms = s.db.prepare("SELECT body FROM messages WHERE kind='confirmation' AND channel='sms'").get().body;
  assert.match(sms, /^Beste Jan, Chauffage Dubois heeft uw aanvraag goed ontvangen \(Vervanging verwarmingsketel\)/);
  const mail = s.db.prepare("SELECT html FROM messages WHERE kind='confirmation' AND channel='email'").get().html;
  assert.match(mail, /Geen e-mails meer ontvangen/);
  // Relance : boutons en néerlandais, page de réponse en néerlandais
  const E = require('../src/engine');
  const a = s.db.prepare('SELECT * FROM accounts WHERE slug=?').get('chauffage-dubois');
  E.setStatus(s.db, a, lead.id, 'devis_envoye', { quote_amount: 4500 });
  assert.match(s.db.prepare("SELECT html FROM messages WHERE kind='relance_1' AND channel='email'").get().html, /Ik aanvaard de offerte/);
  assert.match((await s.req(`/c/${lead.token}`)).text, /Uw offerte/);
  assert.match((await s.req('/s/chauffage-dubois/confidentialite?lang=nl')).text, /Gegevensbeschermingsautoriteit/);
  assert.match((await s.req('/s/chauffage-dubois?lang=nl')).text, /Onze diensten/);
});

test('inscription sans Stripe : compte « à valider », l\'admin valide', async (t) => {
  const s = await boot();
  t.after(() => s.server.close());
  let r = await s.req('/inscription');
  assert.match(r.text, /Essentiel/);
  assert.match(r.text, /79 €/);
  assert.match(r.text, /490 €/);
  const form = { plan: 'essentiel', company_name: 'Thermo Plus', owner_name: 'Ali Ben', email: 'ali@thermo.be', phone: '0478 11 22 33', password: 'motdepasse1', cgv: '1', country: 'BE' };
  r = await s.req('/inscription', { method: 'POST', form });
  assert.match(r.text, /Merci, c'est noté/);
  const a = s.db.prepare("SELECT * FROM accounts WHERE email='ali@thermo.be'").get();
  assert.equal(a.active, 0); assert.equal(a.billing_status, 'a_valider'); assert.equal(a.plan, 'essentiel'); assert.equal(a.monthly_price, 79); assert.equal(a.setup_fee, 290);
  assert.ok(s.db.prepare("SELECT 1 FROM messages WHERE subject LIKE 'Nouvelle inscription%'").get());
  r = await s.login('ali@thermo.be', 'motdepasse1');
  assert.match(r.text, /nous vous appelons très vite/);
  assert.equal((await s.req('/inscription', { method: 'POST', form })).status, 400); // e-mail déjà pris
  await s.login('admin@test.be', 'admin-secret');
  assert.match((await s.req('/admin')).text, /À valider/);
  await s.req(`/admin/comptes/${a.id}/actif`, { method: 'POST', form: {} });
  r = await s.login('ali@thermo.be', 'motdepasse1');
  assert.equal(r.location, '/app');
});

test('inscription avec Stripe (mode test) : paiement, activation, impayé, résiliation', async (t) => {
  const Stripe = require('stripe');
  const B = require('../src/billing');
  const real = new Stripe('sk_test_fake');
  const created = [];
  B._stripe = {
    checkout: { sessions: {
      create: async (p) => { created.push(p); return { url: 'https://checkout.stripe.test/c/pay/cs_test_123' }; },
      retrieve: async (id) => ({ id, status: 'complete', payment_status: 'paid', client_reference_id: String(created[0].client_reference_id), customer: 'cus_123', subscription: 'sub_123' }),
    } },
    webhooks: real.webhooks,
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.test/p/session' }) } },
  };
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const s = await boot();
  t.after(() => { s.server.close(); B._stripe = null; delete process.env.STRIPE_WEBHOOK_SECRET; });
  let r = await s.req('/inscription', { method: 'POST', form: { plan: 'complet', company_name: 'Thermo Plus', owner_name: 'Ali Ben', email: 'ali@thermo.be', phone: '0478 11 22 33', password: 'motdepasse1', cgv: '1' } });
  assert.equal(r.status, 303);
  assert.match(r.location, /checkout\.stripe\.test/);
  const p = created[0];
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.line_items.map((l) => [l.price_data.unit_amount, !!l.price_data.recurring]), [[12900, true], [49000, false]]);
  let a = s.db.prepare("SELECT * FROM accounts WHERE email='ali@thermo.be'").get();
  assert.equal(a.active, 0);
  // Connexion avant d'avoir payé -> renvoyé vers le paiement
  r = await s.login('ali@thermo.be', 'motdepasse1');
  assert.match(r.location, /checkout\.stripe\.test/);
  // Retour de Stripe
  r = await s.req('/inscription/merci?session_id=cs_test_123');
  assert.match(r.location, /^\/app\?ok=/);
  a = s.db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
  assert.equal(a.active, 1); assert.equal(a.billing_status, 'actif'); assert.equal(a.stripe_customer_id, 'cus_123');
  assert.match((await s.req('/app/abonnement')).text, /Complet/);
  assert.match((await s.req('/app/abonnement/portail', { method: 'POST', form: {}, headers: { origin: s.base } })).location, /billing\.stripe\.test/);
  // Webhooks signés
  const post = async (event, sig) => {
    const payload = JSON.stringify(event);
    const res = await fetch(s.base + '/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig || real.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' }) }, body: payload });
    return res.status;
  };
  assert.equal(await post({ type: 'invoice.payment_failed', data: { object: { subscription: 'sub_123', customer: 'cus_123' } } }, 't=1,v1=faux'), 400); // fausse signature
  assert.equal(await post({ type: 'invoice.payment_failed', data: { object: { subscription: 'sub_123', customer: 'cus_123' } } }), 200);
  assert.equal(s.db.prepare('SELECT billing_status FROM accounts WHERE id=?').get(a.id).billing_status, 'impaye');
  await post({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_123', customer: 'cus_123', status: 'canceled' } } });
  a = s.db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
  assert.equal(a.active, 0); assert.equal(a.billing_status, 'resilie');
});
