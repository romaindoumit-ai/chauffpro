// Comptes de démonstration : un prospect ouvre /demo et reçoit son propre compte rempli de fausses données.
// Un compte démo n'envoie jamais de vrai SMS ni de vrai e-mail, et il est supprimé au bout de 24 h.
const U = require('./util');
const E = require('./engine');

const DEMO_TTL_HOURS = 24;
const MAX_DEMOS = 300;

const PEOPLE = [
  // prénom, nom, mobile, e-mail, commune, code postal, projet, statut, montant, il y a N jours
  ['Sophie', 'Martin', '0471 22 33 44', 'sophie.martin@exemple.be', 'Ixelles', '1050', 'Installation pompe à chaleur', 'devis_envoye', 14800, 9],
  ['Karim', 'Benali', '0472 33 44 55', 'karim.b@exemple.be', 'Schaerbeek', '1030', 'Remplacement de chaudière', 'devis_envoye', 5200, 3],
  ['Julie', 'Lefèvre', '0473 44 55 66', '', 'Uccle', '1180', 'Entretien ou dépannage chaudière', 'nouveau', null, 0],
  ['Thomas', 'Peeters', '0474 55 66 77', 'thomas.peeters@exemple.be', 'Etterbeek', '1040', 'Installation pompe à chaleur', 'accepte', 13200, 16],
  ['Nadia', 'El Amrani', '0475 66 77 88', 'nadia.elamrani@exemple.be', 'Anderlecht', '1070', 'Chauffe-eau / ballon thermodynamique', 'termine', 3400, 25],
  ['Pieter', 'Janssens', '0476 77 88 99', '', 'Woluwe-Saint-Lambert', '1200', 'Remplacement de chaudière', 'refuse', 6100, 20],
  ['Claire', 'Dubois', '0477 88 99 00', 'claire.dubois@exemple.be', 'Forest', '1190', 'Plancher chauffant / radiateurs', 'rdv', null, 1],
  ['Marc', 'Vandenberghe', '0478 99 00 11', 'marc.vdb@exemple.be', 'Jette', '1090', 'Remplacement de chaudière', 'devis_envoye', 7400, 6],
];

/** Crée un compte rempli d'exemples. Renvoie le compte. */
// isDemo : 1 = démo jetable (effacée après 24 h), 2 = démo permanente. Dans les deux cas, rien n'est vraiment envoyé.
async function seedDemo(db, { email, slug, password, isDemo = 1 } = {}) {
  db.prepare(`INSERT INTO accounts (slug, company_name, owner_name, email, password_hash, phone, city, zone, google_review_url, address, siret, webhook_token, about, services, country, is_demo, monthly_price, created_at)
    VALUES (?,'Dupont Chauffage','Marc Dupont',?,?,'+32470123456','Bruxelles','Bruxelles et les 19 communes','https://g.page/r/exemple/review','Rue des Artisans 12, 1050 Ixelles','0123.456.789',?,
    'Chauffagiste agréé à Bruxelles depuis 15 ans : pompes à chaleur, chaudières, entretien et dépannage. Devis gratuit sous 48 h.',
    'Installation de pompes à chaleur\nRemplacement de chaudières gaz et mazout\nEntretien et attestation de contrôle périodique\nDépannage rapide','BE',?,0,?)`)
    .run(slug, email, U.hashPassword(password || U.token(12)), U.token(), isDemo, U.iso(new Date()));
  const a = db.prepare('SELECT * FROM accounts WHERE slug=?').get(slug);
  const ago = (d) => U.iso(U.addDays(new Date(), -d));
  for (const [fn, ln, ph, em, city, cp, wt, status, amount, daysAgo] of PEOPLE) {
    const l = E.createLead(db, a, { first_name: fn, last_name: ln, phone: ph, email: em, city, postal_code: cp, work_type: wt, consent: 1,
      message: 'Logement : Maison, 110 m² · Chauffage actuel : Gaz · Délai : Dans le mois' }, { notify: false, confirm: false, source: daysAgo % 2 ? 'formulaire' : 'site' });
    db.prepare('UPDATE leads SET created_at=?, updated_at=? WHERE id=?').run(ago(daysAgo + 2), ago(daysAgo), l.id);
    if (status === 'nouveau') { db.prepare('UPDATE leads SET created_at=? WHERE id=?').run(U.iso(U.addHours(new Date(), -2)), l.id); continue; }
    if (status === 'rdv') {
      E.setStatus(db, a, l.id, 'rdv');
      const day = require('./visits').available(db, a)[1];
      if (day) E.setVisit(db, a, l.id, day.slots[Math.min(1, day.slots.length - 1)].iso, { notifyClient: false });
      continue;
    }
    E.setStatus(db, a, l.id, 'devis_envoye', { quote_amount: amount, quote_ref: `D2026-${100 + l.id}` });
    // On « vieillit » le devis : les relances déjà passées sont marquées comme envoyées.
    const sentAt = U.addDays(new Date(), -daysAgo);
    db.prepare('UPDATE leads SET quote_sent_at=? WHERE id=?').run(U.iso(sentAt), l.id);
    for (const m of db.prepare(`SELECT * FROM messages WHERE lead_id=? AND kind LIKE 'relance%'`).all(l.id)) {
      const n = +m.kind.slice(-1), at = U.nextAllowed(U.addDays(sentAt, [0, 2, 7, 14][n]), E.settingsOf(a).window);
      if (at < new Date()) db.prepare(`UPDATE messages SET status='simule', scheduled_at=?, sent_at=? WHERE id=?`).run(U.iso(at), U.iso(at), m.id);
      else db.prepare('UPDATE messages SET scheduled_at=? WHERE id=?').run(U.iso(at), m.id);
    }
    if (status === 'devis_envoye') continue;
    E.setStatus(db, a, l.id, status === 'termine' ? 'accepte' : status);
    db.prepare('UPDATE leads SET decided_at=? WHERE id=?').run(ago(Math.max(0, daysAgo - 5)), l.id);
    if (status === 'termine') {
      E.setStatus(db, a, l.id, 'termine');
      db.prepare(`UPDATE messages SET status='simule', sent_at=? WHERE lead_id=? AND kind='avis'`).run(ago(1), l.id);
      db.prepare('UPDATE leads SET review_clicked_at=? WHERE id=?').run(ago(1), l.id);
    }
  }
  // Un client qui a demandé à être rappelé, et un appel manqué ce matin.
  const marc = db.prepare(`SELECT * FROM leads WHERE account_id=? AND last_name='Vandenberghe'`).get(a.id);
  if (marc) E.clientChoice(db, marc, 'rappel');
  db.prepare(`UPDATE messages SET status='simule', sent_at=? WHERE account_id=? AND kind='notif'`).run(U.iso(new Date()), a.id);
  E.missedCall(db, a, '0479 12 34 56');
  await E.processDue(db);
  return db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
}

/** Nouveau compte démo jetable pour un visiteur. */
async function createDemoAccount(db) {
  const n = db.prepare('SELECT COUNT(*) n FROM accounts WHERE is_demo=1').get().n;
  if (n >= MAX_DEMOS) purgeDemos(db, new Date(), 0); // trop de démos ouvertes : on repart de zéro
  const id = U.token(6).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  return seedDemo(db, { email: `demo-${id}@demo.invalid`, slug: `demo-${id}` });
}

/** Supprime les comptes démo de plus de `hours` heures (avec toutes leurs données). */
function purgeDemos(db, at = new Date(), hours = DEMO_TTL_HOURS) {
  return Number(db.prepare('DELETE FROM accounts WHERE is_demo=1 AND created_at<=?').run(U.iso(U.addHours(at, -hours))).changes);
}

module.exports = { seedDemo, createDemoAccount, purgeDemos, DEMO_TTL_HOURS };
