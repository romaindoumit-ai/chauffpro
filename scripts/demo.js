// Crée (ou recrée) un compte de démonstration permanent : demo@chauffpro.fr / demo1234.
// Pour une démo jetable par prospect, il suffit d'envoyer le lien https://votre-adresse/demo
// Usage : npm run demo
process.removeAllListeners('warning');
const { openDb } = require('../src/db');
const { ensureAdmin } = require('../src/auth');
const { seedDemo } = require('../src/demo');
const E = require('../src/engine');

(async () => {
  const db = openDb();
  ensureAdmin(db);
  const email = 'demo@chauffpro.fr';
  db.prepare('DELETE FROM accounts WHERE email=? OR slug=?').run(email, 'dupont-chauffage');
  await seedDemo(db, { email, slug: 'dupont-chauffage', password: 'demo1234', isDemo: 2 });
  console.log(`Compte de démonstration prêt : ${email} / demo1234`);
  console.log(`Formulaire : ${E.BASE()}/f/dupont-chauffage · Mini-site : ${E.BASE()}/s/dupont-chauffage`);
  console.log(`Démo jetable pour un prospect : ${E.BASE()}/demo`);
})();
