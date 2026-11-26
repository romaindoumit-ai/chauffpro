process.removeAllListeners('warning');
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const E = require('../src/engine');
const U = require('../src/util');

function setup(country = 'FR') {
  const db = openDb(':memory:');
  db.prepare(`INSERT INTO accounts (slug, company_name, owner_name, email, password_hash, phone, google_review_url, webhook_token, settings, country) VALUES ('test','Test Chauffage','Jean Test','jean@test.fr','x','+33611111111','https://g.page/r/x/review','wh','{"sms_footer":"STOP au 36000"}',?)`).run(country);
  return { db, a: db.prepare('SELECT * FROM accounts').get() };
}
const msgs = (db, id) => db.prepare('SELECT * FROM messages WHERE lead_id=? ORDER BY id').all(id);

test('numéros de téléphone français', () => {
  assert.equal(U.normalizePhone('06 12 34 56 78', 'FR'), '+33612345678');
  assert.equal(U.normalizePhone('+33 6 12 34 56 78', 'FR'), '+33612345678');
  assert.equal(U.normalizePhone('0033612345678', 'FR'), '+33612345678');
  assert.equal(U.normalizePhone('04 78 00 00 00', 'FR'), '+33478000000');
  assert.equal(U.normalizePhone('123'), '');
  assert.ok(U.isMobile('+33712345678'));
  assert.ok(!U.isMobile('+33412345678'));
});

test('numéros de téléphone belges', () => {
  assert.equal(U.normalizePhone('0470 12 34 56', 'BE'), '+32470123456');
  assert.equal(U.normalizePhone('+32 (0)470 12 34 56', 'BE'), '+32470123456');
  assert.equal(U.normalizePhone('0032 470 12 34 56', 'BE'), '+32470123456');
  assert.equal(U.normalizePhone('02 123 45 67', 'BE'), '+3221234567');
  assert.equal(U.normalizePhone('06 12 34 56 78', 'BE'), '+33612345678'); // mobile français tapé en Belgique
  assert.equal(U.normalizePhone('0212345678', 'BE'), '');
  assert.equal(U.displayPhone('+32470123456'), '0470 12 34 56');
  assert.equal(U.displayPhone('+3221234567'), '02 123 45 67');
  assert.ok(U.isMobile('+32470123456'));
  assert.ok(!U.isMobile('+3221234567'));
});

test('jours fériés belges et français', () => {
  const be = { start: 9, end: 19, country: 'BE' }, fr = { start: 9, end: 19, country: 'FR' };
  assert.ok(!U.inWindow(new Date('2027-07-21T10:00:00Z'), be)); // fête nationale belge (mercredi)
  assert.ok(U.inWindow(new Date('2027-07-21T10:00:00Z'), fr));
  assert.ok(!U.inWindow(new Date('2027-07-14T10:00:00Z'), fr)); // 14 juillet
  assert.ok(U.inWindow(new Date('2027-07-14T10:00:00Z'), be));
  assert.ok(!U.inWindow(new Date('2027-05-06T10:00:00Z'), be)); // Ascension 2027
});

test('compte belge : formulaire et appel manqué avec un numéro belge', () => {
  const { db, a } = setup('BE');
  const l = E.createLead(db, a, { first_name: 'Lotte', phone: '0478 12 34 56', consent: 1 });
  assert.equal(l.phone, '+32478123456');
  assert.ok(msgs(db, l.id).some((m) => m.kind === 'confirmation' && m.channel === 'sms'));
  assert.ok(E.missedCall(db, a, '0479 98 76 54').smsScheduled);
  assert.equal(E.missedCall(db, a, '02 513 00 00').smsScheduled, false); // fixe bruxellois
});

test("fenêtre d'envoi : pas le dimanche, pas les jours fériés, 9h-19h", () => {
  assert.ok(!U.inWindow(new Date('2026-11-29T10:00:00Z'))); // dimanche
  assert.ok(!U.inWindow(new Date('2026-12-25T10:00:00Z'))); // Noël
  assert.ok(!U.inWindow(new Date('2027-03-29T10:00:00Z'))); // lundi de Pâques 2027
  assert.ok(U.inWindow(new Date('2026-11-25T10:00:00Z')));
  assert.ok(!U.inWindow(new Date('2026-11-25T19:30:00Z'))); // 20h30 Paris
  assert.equal(U.nextAllowed(new Date('2026-11-28T19:30:00Z')).toISOString(), '2026-11-30T08:00:00.000Z');
});

test('formulaire -> accusé de réception + alerte artisan', () => {
  const { db, a } = setup();
  const l = E.createLead(db, a, { first_name: 'Paul', phone: '0612345678', email: 'paul@x.fr', work_type: 'Installation pompe à chaleur', consent: 1 });
  const m = msgs(db, l.id);
  assert.deepEqual(m.map((x) => `${x.kind}:${x.channel}`).sort(), ['confirmation:email', 'confirmation:sms', 'notif:email']);
  assert.match(m.find((x) => x.kind === 'confirmation' && x.channel === 'sms').body, /Bonjour Paul, Test Chauffage a bien reçu/);
});

test('devis envoyé -> 3 relances SMS + e-mail, arrêtées si le client accepte', async () => {
  const { db, a } = setup();
  const l = E.createLead(db, a, { first_name: 'Paul', phone: '0612345678', email: 'paul@x.fr', consent: 1 }, { notify: false, confirm: false });
  E.setStatus(db, a, l.id, 'devis_envoye', { quote_amount: 9000 });
  let rel = msgs(db, l.id).filter((m) => m.kind.startsWith('relance'));
  assert.equal(rel.length, 6);
  const d1 = (new Date(rel[0].scheduled_at) - Date.now()) / 86400000;
  assert.ok(d1 >= 1.9 && d1 < 5, `relance 1 à J+${d1}`);
  assert.match(rel[0].body, /STOP/);
  // à J+3 la première relance part
  const sent = await E.processDue(db, U.nextAllowed(U.addDays(new Date(), 3)));
  assert.ok(sent >= 2);
  assert.equal(msgs(db, l.id).filter((m) => m.status === 'simule').length, 2);
  // le client clique « j'accepte »
  E.clientChoice(db, E.getLead(db, l.id), 'ok');
  assert.equal(E.getLead(db, l.id).status, 'accepte');
  rel = msgs(db, l.id).filter((m) => m.kind.startsWith('relance'));
  assert.equal(rel.filter((m) => m.status === 'en_attente').length, 0);
  const st = E.stats(db, a.id, U.addDays(new Date(), -1), U.addDays(new Date(), 30));
  assert.equal(st.signes, 1); assert.equal(st.ca, 9000);
});

test('chantier terminé -> avis Google + rappel annulé si le lien est cliqué', async () => {
  const { db, a } = setup();
  const l = E.createLead(db, a, { first_name: 'Léa', phone: '0712345678', consent: 1 }, { notify: false, confirm: false });
  E.setStatus(db, a, l.id, 'termine');
  const av = msgs(db, l.id).filter((m) => m.kind.startsWith('avis'));
  assert.deepEqual(av.map((m) => m.kind), ['avis', 'avis_relance']);
  assert.match(av[0].body, /\/avis\//);
  E.updateLead(db, l.id, { review_clicked_at: U.iso(new Date()) });
  await E.processDue(db, U.addDays(new Date(), 30));
  assert.equal(msgs(db, l.id).find((m) => m.kind === 'avis_relance').status, 'annule');
});

test('appel manqué -> SMS immédiat, pas de doublon, pas de SMS vers un fixe', () => {
  const { db, a } = setup();
  const r1 = E.missedCall(db, a, '06 98 76 54 32');
  assert.ok(r1.smsScheduled);
  assert.match(msgs(db, r1.leadId).find((m) => m.kind === 'appel').body, /\/rdv\/test\?l=/);
  assert.ok(E.missedCall(db, a, '0698765432').skipped);
  assert.equal(E.missedCall(db, a, '0478000000').smsScheduled, false);
});

test('STOP -> plus aucun SMS', () => {
  const { db, a } = setup();
  const l = E.createLead(db, a, { first_name: 'Max', phone: '0612121212', consent: 1 }, { notify: false, confirm: false });
  E.setStatus(db, a, l.id, 'devis_envoye');
  E.optOutPhone(db, '+33612121212');
  assert.equal(msgs(db, l.id).filter((m) => m.status === 'en_attente').length, 0);
  E.setStatus(db, a, l.id, 'devis_envoye');
  assert.equal(msgs(db, l.id).filter((m) => m.status === 'en_attente').length, 0);
});

test('bilan mensuel envoyé une seule fois le 1er du mois', () => {
  const { db } = setup();
  const first = new Date('2026-12-01T09:30:00Z');
  assert.equal(E.monthlyReports(db, first), 1);
  assert.equal(E.monthlyReports(db, first), 0);
});

test("chantier terminé -> rappel d'entretien 12 mois plus tard, puis chaque année", async () => {
  const { db, a } = setup('BE');
  const l = E.createLead(db, a, { first_name: 'Lotte', phone: '0478123456', email: 'lotte@x.be', work_type: 'Remplacement de chaudière', consent: 1 }, { notify: false, confirm: false });
  E.setStatus(db, a, l.id, 'termine');
  const ent = msgs(db, l.id).filter((m) => m.kind === 'entretien');
  assert.deepEqual(ent.map((m) => m.channel).sort(), ['email', 'sms']);
  const months = (new Date(ent[0].scheduled_at) - Date.now()) / (30.4 * 86400000);
  assert.ok(months > 11.5 && months < 12.5, `rappel dans ${months} mois`);
  assert.match(ent.find((m) => m.channel === 'sms').body, /\/rdv\/test\?l=/);
  // Un an plus tard, les deux partent et l'année suivante est programmée (une seule fois)
  await E.processDue(db, U.nextAllowed(U.addDays(new Date(), 370), { start: 9, end: 19, country: 'BE' }));
  const after = msgs(db, l.id).filter((m) => m.kind === 'entretien');
  assert.equal(after.filter((m) => m.status === 'simule').length, 2);
  assert.equal(after.filter((m) => m.status === 'en_attente').length, 2);
});

test("un seul rappel d'entretien en attente par client", () => {
  const { db, a } = setup('BE');
  const l1 = E.createLead(db, a, { first_name: 'Lotte', phone: '0478123456', consent: 1 }, { notify: false, confirm: false });
  E.setStatus(db, a, l1.id, 'termine');
  const l2 = E.createLead(db, a, { first_name: 'Lotte', phone: '0478 12 34 56', consent: 1 }, { notify: false, confirm: false });
  E.setStatus(db, a, l2.id, 'termine');
  assert.equal(msgs(db, l1.id).filter((m) => m.kind === 'entretien' && m.status === 'en_attente').length, 0);
  assert.equal(msgs(db, l2.id).filter((m) => m.kind === 'entretien' && m.status === 'en_attente').length, 1);
});
