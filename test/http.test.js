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
