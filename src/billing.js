// Abonnements : inscription en libre-service et paiement par Stripe.
// Sans STRIPE_SECRET_KEY : les inscriptions arrivent « à valider » dans l'administration (rien n'est encaissé).
// Avec une clé de test (sk_test_…) : vrai parcours de paiement, avec de fausses cartes (4242 4242 4242 4242).
const U = require('./util');

const PLANS = {
  essentiel: {
    name: 'Essentiel', monthly: 79, setup: 290,
    features: ['Formulaire de devis et tableau de bord', 'Relances automatiques des devis (SMS + e-mail)', "Demandes d'avis Google", "Rappel d'entretien annuel", 'Appli sur le téléphone + notifications', 'Bilan mensuel'],
  },
  complet: {
    name: 'Complet', monthly: 129, setup: 490,
    features: ['Tout Essentiel', 'Mini-site vitrine', 'SMS automatique après un appel manqué', 'Réservation de visites en ligne', 'Formulaire et messages en néerlandais', 'Assistant IA (si activé)'],
  },
};

const key = () => process.env.STRIPE_SECRET_KEY || '';
const enabled = () => !!key() || !!module.exports._stripe;
const testMode = () => key().startsWith('sk_test_') || key().startsWith('rk_test_');
let stripe = null;
function client() {
  if (module.exports._stripe) return module.exports._stripe; // tests
  if (!stripe) { const Stripe = require('stripe'); stripe = new Stripe(key()); }
  return stripe;
}
const BASE = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

/** Crée le compte artisan (inactif tant que le paiement ou la validation n'est pas fait). */
function createAccount(db, { company_name, owner_name, email, phone, password, plan, country, city, active = 0, billing_status = 'en_attente' }) {
  const p = PLANS[plan] || PLANS.complet;
  let slug = U.slugify(company_name), i = 1;
  while (db.prepare('SELECT 1 FROM accounts WHERE slug=?').get(slug)) slug = `${U.slugify(company_name)}-${++i}`;
  const cc = U.COUNTRIES[country] ? country : U.DEFAULT_COUNTRY();
  const r = db.prepare(`INSERT INTO accounts (slug, company_name, owner_name, email, password_hash, phone, city, webhook_token, country, plan, monthly_price, setup_fee, active, billing_status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, company_name, owner_name || '', email, U.hashPassword(password), U.normalizePhone(phone, cc), city || '', U.token(), cc,
    PLANS[plan] ? plan : 'complet', p.monthly, p.setup, active, billing_status, U.iso(new Date()));
  return db.prepare('SELECT * FROM accounts WHERE id=?').get(Number(r.lastInsertRowid));
}

/** Page de paiement Stripe : mise en place (une fois) + abonnement mensuel. */
async function checkoutUrl(account) {
  const p = PLANS[account.plan] || PLANS.complet;
  const s = await client().checkout.sessions.create({
    mode: 'subscription',
    locale: 'fr',
    customer_email: account.email,
    client_reference_id: String(account.id),
    metadata: { account_id: String(account.id) },
    subscription_data: { metadata: { account_id: String(account.id) } },
    line_items: [
      { quantity: 1, price_data: { currency: 'eur', unit_amount: p.monthly * 100, recurring: { interval: 'month' }, product_data: { name: `ChauffPro ${p.name} (abonnement mensuel)` } } },
      { quantity: 1, price_data: { currency: 'eur', unit_amount: p.setup * 100, product_data: { name: `ChauffPro ${p.name} : mise en place` } } },
    ],
    success_url: `${BASE()}/inscription/merci?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${BASE()}/inscription/annule?compte=${account.id}`,
  });
  return s.url;
}

/** Active le compte après un paiement confirmé par Stripe. Renvoie le compte ou null. */
function activateFromSession(db, session) {
  const id = Number(session.client_reference_id || (session.metadata && session.metadata.account_id));
  const a = id && db.prepare('SELECT * FROM accounts WHERE id=? AND is_admin=0').get(id);
  if (!a) return null;
  const paid = session.status === 'complete' || session.payment_status === 'paid';
  if (!paid) return null;
  const first = a.billing_status !== 'actif';
  db.prepare(`UPDATE accounts SET active=1, billing_status='actif', stripe_customer_id=?, stripe_subscription_id=? WHERE id=?`)
    .run(String(session.customer || a.stripe_customer_id || ''), String(session.subscription || a.stripe_subscription_id || ''), a.id);
  if (first) notifyAdmin(db, `🎉 Nouveau client payé : ${a.company_name}`, `${a.company_name} (${a.email}) vient de payer la formule ${(PLANS[a.plan] || PLANS.complet).name}. Le compte est actif.`);
  return db.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
}

/** Événements envoyés par Stripe (paiement, impayé, résiliation). */
function handleEvent(db, event) {
  const o = event.data && event.data.object ? event.data.object : {};
  const bySub = (subId, custId) => db.prepare('SELECT * FROM accounts WHERE (stripe_subscription_id=? AND stripe_subscription_id<>\'\') OR (stripe_customer_id=? AND stripe_customer_id<>\'\')').get(String(subId || '-'), String(custId || '-'));
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return !!activateFromSession(db, o);
    case 'invoice.payment_failed': {
      const a = bySub(o.subscription, o.customer); if (!a) return false;
      db.prepare(`UPDATE accounts SET billing_status='impaye' WHERE id=?`).run(a.id);
      notifyAdmin(db, `⚠ Paiement refusé : ${a.company_name}`, `Le prélèvement de ${a.company_name} (${a.email}) a échoué. Stripe va réessayer automatiquement ; le compte reste actif pour l'instant.`);
      return true;
    }
    case 'invoice.paid': {
      const a = bySub(o.subscription, o.customer); if (!a) return false;
      if (a.billing_status === 'impaye') db.prepare(`UPDATE accounts SET billing_status='actif', active=1 WHERE id=?`).run(a.id);
      return true;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const a = bySub(o.id, o.customer); if (!a) return false;
      if (event.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(o.status)) {
        db.prepare(`UPDATE accounts SET active=0, billing_status='resilie' WHERE id=?`).run(a.id);
        notifyAdmin(db, `Abonnement arrêté : ${a.company_name}`, `L'abonnement de ${a.company_name} (${a.email}) est arrêté (${o.status || 'résilié'}). Le compte est suspendu.`);
      }
      return true;
    }
    default: return false;
  }
}

function notifyAdmin(db, subject, text) {
  const admin = db.prepare('SELECT * FROM accounts WHERE is_admin=1 ORDER BY id LIMIT 1').get();
  if (admin) require('./engine').notifyArtisan(db, admin, null, subject, text);
}

/** Lien vers l'espace client Stripe (carte bancaire, factures, résiliation). */
async function portalUrl(account) {
  const s = await client().billingPortal.sessions.create({ customer: account.stripe_customer_id, return_url: `${BASE()}/app/abonnement` });
  return s.url;
}

module.exports = { PLANS, enabled, testMode, createAccount, checkoutUrl, activateFromSession, handleEvent, portalUrl, notifyAdmin, client, _stripe: null };
