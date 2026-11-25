// Crée un compte de démonstration avec des données d'exemple (pour montrer l'outil à un prospect).
// Usage : npm run demo
process.removeAllListeners('warning');
const { openDb } = require('../src/db');
const { ensureAdmin } = require('../src/auth');
const E = require('../src/engine');
const U = require('../src/util');

(async () => {
  const db = openDb();
  ensureAdmin(db);
  const email = 'demo@chauffpro.fr';
  db.prepare('DELETE FROM accounts WHERE email=?').run(email);
  db.prepare(`INSERT INTO accounts (slug, company_name, owner_name, email, password_hash, phone, city, zone, google_review_url, address, siret, webhook_token, about, created_at)
    VALUES ('dupont-chauffage','Dupont Chauffage','Marc Dupont',?,?,'+33612345678','Lyon','Lyon et 30 km autour','https://g.page/r/exemple/review','12 rue des Artisans, 69003 Lyon','123 456 789 00012',?,
    'Chauffagiste RGE à Lyon depuis 15 ans : pompes à chaleur, chaudières, entretien et dépannage. Devis gratuit sous 48 h.',?)`)
    .run(email, U.hashPassword('demo1234'), U.token(), U.iso(U.addDays(new Date(), -60)));
  const a = db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
  const people = [
    ['Sophie', 'Martin', '0611223344', 'sophie.martin@exemple.fr', 'Villeurbanne', 'Installation pompe à chaleur', 'devis_envoye', 14800, 9],
    ['Karim', 'Benali', '0622334455', 'karim.b@exemple.fr', 'Bron', 'Remplacement de chaudière', 'devis_envoye', 5200, 3],
    ['Julie', 'Lefèvre', '0633445566', '', 'Caluire', 'Entretien ou dépannage chaudière', 'nouveau', null, 0],
    ['Thomas', 'Roux', '0644556677', 'thomas.roux@exemple.fr', 'Lyon 7e', 'Installation pompe à chaleur', 'accepte', 13200, 16],
    ['Nadia', 'Petit', '0655667788', 'nadia.p@exemple.fr', 'Vénissieux', 'Chauffe-eau / ballon thermodynamique', 'termine', 3400, 25],
    ['Pierre', 'Garnier', '0766778899', '', 'Écully', 'Remplacement de chaudière', 'refuse', 6100, 20],
    ['Claire', 'Moreau', '0677889900', 'claire.m@exemple.fr', 'Lyon 3e', 'Plancher chauffant / radiateurs', 'rdv', null, 1],
  ];
  for (const [fn, ln, ph, em, city, wt, status, amount, daysAgo] of people) {
    const l = E.createLead(db, a, { first_name: fn, last_name: ln, phone: ph, email: em, city, postal_code: '69000', work_type: wt, consent: 1, message: 'Logement : Maison, 110 m² · Chauffage actuel : Fioul' }, { notify: false, confirm: false, source: daysAgo % 2 ? 'formulaire' : 'site' });
    const past = U.iso(U.addDays(new Date(), -daysAgo));
    db.prepare('UPDATE leads SET created_at=? WHERE id=?').run(past, l.id);
    if (status === 'nouveau' || status === 'rdv') { if (status === 'rdv') E.setStatus(db, a, l.id, 'rdv'); continue; }
    E.setStatus(db, a, l.id, 'devis_envoye', { quote_amount: amount, quote_ref: `D2026-${100 + l.id}` });
    // On « vieillit » le devis : les relances déjà passées sont marquées comme envoyées
    const sentAt = U.addDays(new Date(), -daysAgo + 1);
    db.prepare('UPDATE leads SET quote_sent_at=? WHERE id=?').run(U.iso(sentAt), l.id);
    for (const m of db.prepare(`SELECT * FROM messages WHERE lead_id=? AND kind LIKE 'relance%'`).all(l.id)) {
      const n = +m.kind.slice(-1), at = U.addDays(sentAt, [0, 2, 7, 14][n]);
      if (at < new Date()) db.prepare(`UPDATE messages SET status='simule', scheduled_at=?, sent_at=? WHERE id=?`).run(U.iso(at), U.iso(at), m.id);
      else db.prepare(`UPDATE messages SET scheduled_at=? WHERE id=?`).run(U.iso(U.nextAllowed(at)), m.id);
    }
    if (status === 'devis_envoye') continue;
    E.setStatus(db, a, l.id, status === 'termine' ? 'accepte' : status);
    if (status === 'termine') { E.setStatus(db, a, l.id, 'termine'); db.prepare(`UPDATE messages SET status='simule', sent_at=? WHERE lead_id=? AND kind='avis'`).run(U.iso(new Date()), l.id); db.prepare('UPDATE leads SET review_clicked_at=? WHERE id=?').run(U.iso(new Date()), l.id); }
  }
  E.missedCall(db, a, '0698765432');
  await E.processDue(db);
  console.log('Compte de démonstration prêt : demo@chauffpro.fr / demo1234');
  console.log(`Formulaire : ${E.BASE()}/f/dupont-chauffage · Mini-site : ${E.BASE()}/s/dupont-chauffage`);
})();
