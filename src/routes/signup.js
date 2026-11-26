// Inscription en libre-service : l'artisan choisit sa formule, crée son compte et paie en ligne.
const express = require('express');
const U = require('../util');
const B = require('../billing');
const { publicLayout, APP_NAME } = require('../views');
const { createSession } = require('../auth');

const hits = new Map();
const limited = (ip) => { const t = Date.now(), arr = (hits.get(ip) || []).filter((x) => t - x < 3600000); arr.push(t); hits.set(ip, arr); return arr.length > 6; };

module.exports = (db) => {
  const r = express.Router();
  const eur = (n) => `${n} €`;

  function page(values = {}, error = '') {
    const v = (k) => U.esc(values[k] || '');
    const plan = B.PLANS[values.plan] ? values.plan : 'complet';
    const cards = Object.entries(B.PLANS).map(([k, p]) => `<label class="plan${k === plan ? ' on' : ''}"><input type="radio" name="plan" value="${k}" ${k === plan ? 'checked' : ''}>
<div class="plan-n">${p.name}</div><div class="plan-p"><b>${eur(p.monthly)}</b> /mois</div><div class="small muted">+ ${eur(p.setup)} de mise en place (une fois)</div>
<ul>${p.features.map((f) => `<li>${U.esc(f)}</li>`).join('')}</ul></label>`).join('');
    const test = B.enabled() && B.testMode() ? '<div class="banner info">Mode test : aucun vrai paiement. Utilisez la carte <b>4242 4242 4242 4242</b>, une date future et n\'importe quel code.</div>' : '';
    const noPay = !B.enabled() ? '<p class="small muted">Votre compte sera activé après un rapide appel de mise en place. Aucun paiement n\'est demandé maintenant.</p>' : '<p class="small muted">Paiement sécurisé par Stripe. Résiliable chaque mois depuis votre espace.</p>';
    return publicLayout(`Inscription · ${APP_NAME()}`, `<div class="card"><h1>Démarrer avec ${U.esc(APP_NAME())}</h1>
<p class="muted">Plus de devis signés, plus d'avis Google, sans y passer vos soirées. <a href="/demo">Voir la démo d'abord</a></p>${test}
${error ? `<div class="flash err">${U.esc(error)}</div>` : ''}
<form method="post" action="/inscription"><div class="plans">${cards}</div>
<h2>Votre entreprise</h2>
<div class="row"><div><label>Nom de l'entreprise *</label><input name="company_name" required value="${v('company_name')}"></div><div><label>Votre nom *</label><input name="owner_name" required autocomplete="name" value="${v('owner_name')}"></div></div>
<div class="row"><div><label>E-mail *</label><input name="email" type="email" required autocomplete="email" value="${v('email')}"></div><div><label>Mobile *</label><input name="phone" type="tel" required autocomplete="tel" placeholder="${U.C(null).mobileExample}" value="${v('phone')}"></div></div>
<div class="row"><div><label>Commune</label><input name="city" value="${v('city')}"></div><div><label>Pays</label><select name="country">${Object.entries(U.COUNTRIES).map(([k, c]) => `<option value="${k}" ${(values.country || U.DEFAULT_COUNTRY()) === k ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div></div>
<label>Mot de passe * (8 caractères minimum)</label><input name="password" type="password" minlength="8" required autocomplete="new-password">
<input class="hp" name="website" tabindex="-1" autocomplete="off">
<label class="chk"><input type="checkbox" name="cgv" value="1" required> J'accepte les ${process.env.CGV_URL ? `<a href="${U.esc(process.env.CGV_URL)}" target="_blank" rel="noopener">conditions générales de vente</a>` : 'conditions générales de vente'} et le traitement de mes données pour la gestion de mon compte.</label>
<p><button class="btn" style="width:100%">${B.enabled() ? 'Continuer vers le paiement' : 'Créer mon compte'}</button></p>${noPay}
<p class="small muted">Prix hors TVA.</p></form></div>`);
  }

  r.get('/inscription', (req, res) => res.send(page({ plan: req.query.formule })));
  r.post('/inscription', async (req, res, next) => {
    try {
      const b = req.body || {};
      if (b.website) return res.redirect('/inscription');
      if (limited(req.ip)) return res.status(429).send(page(b, 'Trop de tentatives. Réessayez dans une heure.'));
      const email = String(b.email || '').trim().toLowerCase();
      const country = U.COUNTRIES[b.country] ? b.country : U.DEFAULT_COUNTRY();
      let error = '';
      if (!b.company_name || !b.owner_name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error = 'Merci de remplir tous les champs obligatoires.';
      else if (!U.normalizePhone(b.phone, country)) error = 'Le numéro de mobile semble incorrect.';
      else if (String(b.password || '').length < 8) error = 'Le mot de passe doit faire au moins 8 caractères.';
      else if (!b.cgv) error = 'Merci d\'accepter les conditions générales.';
      else if (db.prepare('SELECT 1 FROM accounts WHERE email=?').get(email)) error = 'Un compte existe déjà avec cet e-mail. Connectez-vous ou contactez-nous.';
      if (error) return res.status(400).send(page(b, error));
      const a = B.createAccount(db, { ...b, email, country, active: 0, billing_status: B.enabled() ? 'en_attente_paiement' : 'a_valider' });
      if (B.enabled()) return res.redirect(303, await B.checkoutUrl(a));
      B.notifyAdmin(db, `Nouvelle inscription à valider : ${a.company_name}`, `${a.company_name} (${a.owner_name}, ${a.email}, ${U.displayPhone(a.phone)}) s'est inscrit en formule ${B.PLANS[a.plan].name}. Validez le compte dans l'administration.`);
      res.send(publicLayout('Inscription reçue', `<div class="card" style="max-width:560px;margin:40px auto"><h1>✅ Merci, c'est noté !</h1><p>Nous vous appelons très vite pour mettre votre compte en place ensemble (environ 20 minutes). Vous recevrez ensuite l'accès à votre espace.</p><p><a href="/demo">En attendant, découvrez la démo</a></p></div>`));
    } catch (e) { next(e); }
  });

  // Retour de Stripe après paiement
  r.get('/inscription/merci', async (req, res, next) => {
    try {
      if (!B.enabled() || !/^cs_[A-Za-z0-9_]+$/.test(req.query.session_id || '')) return res.redirect('/connexion');
      const session = await B.client().checkout.sessions.retrieve(req.query.session_id);
      const a = B.activateFromSession(db, session);
      if (!a) return res.send(publicLayout('Paiement en cours', '<div class="card" style="max-width:560px;margin:40px auto"><h1>Paiement en cours de validation</h1><p>Votre paiement n\'est pas encore confirmé. Vous recevrez un e-mail dès que c\'est fait. <a href="/connexion">Se connecter</a></p></div>'));
      createSession(db, res, a.id);
      res.redirect('/app?ok=' + encodeURIComponent('Bienvenue ! Votre compte est actif. Commencez par Réglages : votre lien d\'avis Google et votre nom d\'expéditeur SMS.'));
    } catch (e) { next(e); }
  });
  r.get('/inscription/annule', (req, res) => res.send(publicLayout('Paiement annulé', `<div class="card" style="max-width:560px;margin:40px auto"><h1>Paiement annulé</h1><p>Rien n'a été débité. Vous pouvez reprendre quand vous voulez en vous connectant avec votre e-mail et votre mot de passe.</p><p><a class="btn" href="/connexion">Reprendre le paiement</a></p></div>`)));

  return r;
};
