// Administration (vous, le prestataire) : création et suivi des comptes artisans.
const express = require('express');
const U = require('../util');
const E = require('../engine');
const { appLayout } = require('../views');
const { createSession } = require('../auth');

module.exports = (db) => {
  const r = express.Router();
  r.get('/', (req, res) => {
    const ym = E.currentMonth(); const [f, t] = E.monthRange(ym);
    const accounts = db.prepare('SELECT * FROM accounts WHERE is_admin=0 ORDER BY created_at DESC').all();
    const mrr = accounts.filter((a) => a.active).reduce((s, a) => s + (a.monthly_price || 0), 0);
    const sent = db.prepare(`SELECT channel, COUNT(*) n FROM messages WHERE status IN ('envoye','simule') AND sent_at>=? AND sent_at<? AND kind<>'notif' GROUP BY channel`).all(U.iso(f), U.iso(t));
    const sms = sent.find((x) => x.channel === 'sms')?.n || 0, mails = sent.find((x) => x.channel === 'email')?.n || 0;
    const fails = db.prepare(`SELECT COUNT(*) n FROM messages WHERE status='echec' AND created_at>=?`).get(U.iso(U.addDays(new Date(), -7))).n;
    const rows = accounts.map((a) => {
      const st = E.stats(db, a.id, f, t);
      return `<tr><td><b>${U.esc(a.company_name)}</b><div class="small muted">${U.esc(a.owner_name || '')} · ${U.esc(a.email)} · ${U.esc(U.displayPhone(a.phone))}</div></td>
<td>${a.active ? '<span class="badge" style="background:#2f9e44">Actif</span>' : '<span class="badge" style="background:#868e96">Suspendu</span>'}<div class="small">${a.monthly_price} €/mois</div></td>
<td class="small">${st.demandes} demandes · ${st.devis} devis<br>${st.relances} relances · ${st.signes} signés (${U.euros(st.ca)})<br>${st.avisDemandes} avis demandés</td>
<td class="actions"><form method="post" action="/admin/comptes/${a.id}/connexion"><button class="btn sm">Ouvrir</button></form>
<form method="post" action="/admin/comptes/${a.id}/actif"><button class="btn sm sec">${a.active ? 'Suspendre' : 'Réactiver'}</button></form>
<form method="post" action="/admin/comptes/${a.id}/mot-de-passe"><button class="btn sm sec">Nouveau mot de passe</button></form></td></tr>`;
    }).join('');
    const pw = req.query.pw ? `<div class="flash">Identifiants à transmettre à l'artisan : <b>${U.esc(req.query.email)}</b> / mot de passe <b>${U.esc(req.query.pw)}</b> · connexion sur ${E.BASE()}/connexion</div>` : '';
    res.send(appLayout(req, 'Administration', `<h1>Administration</h1>${pw}
<div class="grid g4"><div class="card kpi"><div class="v">${accounts.filter((a) => a.active).length}</div><div class="l">artisans actifs</div></div><div class="card kpi"><div class="v">${U.euros(mrr)}</div><div class="l">revenu mensuel récurrent</div></div>
<div class="card kpi"><div class="v">${sms}</div><div class="l">SMS envoyés ce mois</div></div><div class="card kpi"><div class="v">${mails}</div><div class="l">e-mails envoyés ce mois</div></div></div>
${fails ? `<div class="banner" style="margin-top:12px">⚠ ${fails} envoi(s) en échec ces 7 derniers jours : ouvrez les comptes concernés, onglet Messages › Échec.</div>` : ''}
<h2>Artisans</h2>${rows ? `<table><tr><th>Artisan</th><th>Abonnement</th><th>Ce mois-ci</th><th></th></tr>${rows}</table>` : '<div class="card muted">Aucun artisan pour l\'instant.</div>'}
<h2>Ajouter un artisan</h2><div class="card" style="max-width:720px"><form method="post" action="/admin/comptes">
<div class="row"><div><label>Entreprise *</label><input name="company_name" required></div><div><label>Nom du gérant</label><input name="owner_name"></div></div>
<div class="row"><div><label>E-mail *</label><input name="email" type="email" required></div><div><label>Mobile</label><input name="phone"></div></div>
<div class="row"><div><label>Ville</label><input name="city"></div><div><label>Abonnement (€/mois)</label><input name="monthly_price" type="number" value="99"></div></div>
<label>Lien avis Google</label><input name="google_review_url">
<p><button class="btn">Créer le compte</button></p></form></div>`, 'admin'));
  });
  r.post('/comptes', (req, res) => {
    const b = req.body;
    const email = String(b.email || '').trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM accounts WHERE email=?').get(email)) return res.redirect('/admin?err=' + encodeURIComponent('Cet e-mail existe déjà.'));
    let slug = U.slugify(b.company_name), i = 1;
    while (db.prepare('SELECT 1 FROM accounts WHERE slug=?').get(slug)) slug = `${U.slugify(b.company_name)}-${++i}`;
    const pw = U.token(6);
    db.prepare(`INSERT INTO accounts (slug, company_name, owner_name, email, password_hash, phone, city, google_review_url, monthly_price, webhook_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slug, b.company_name, b.owner_name || '', email, U.hashPassword(pw), U.normalizePhone(b.phone), b.city || '', b.google_review_url || '', +b.monthly_price || 0, U.token(), U.iso(new Date()));
    res.redirect(`/admin?email=${encodeURIComponent(email)}&pw=${encodeURIComponent(pw)}`);
  });
  const adminId = (req) => (req.account.is_admin ? req.account.id : req.adminId);
  r.post('/comptes/:id/connexion', (req, res) => {
    const a = db.prepare('SELECT * FROM accounts WHERE id=? AND is_admin=0').get(req.params.id); if (!a) return res.redirect('/admin');
    db.prepare('DELETE FROM sessions WHERE id=?').run(req.sessionId);
    createSession(db, res, a.id, adminId(req));
    res.redirect('/app');
  });
  r.post('/retour', (req, res) => {
    const id = adminId(req);
    db.prepare('DELETE FROM sessions WHERE id=?').run(req.sessionId);
    createSession(db, res, id, null);
    res.redirect('/admin');
  });
  r.post('/comptes/:id/actif', (req, res) => { db.prepare('UPDATE accounts SET active=1-active WHERE id=? AND is_admin=0').run(req.params.id); res.redirect('/admin?ok=' + encodeURIComponent('Compte mis à jour.')); });
  r.post('/comptes/:id/mot-de-passe', (req, res) => {
    const a = db.prepare('SELECT * FROM accounts WHERE id=? AND is_admin=0').get(req.params.id); if (!a) return res.redirect('/admin');
    const pw = U.token(6);
    db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(U.hashPassword(pw), a.id);
    db.prepare('DELETE FROM sessions WHERE account_id=? AND admin_id IS NULL').run(a.id);
    res.redirect(`/admin?email=${encodeURIComponent(a.email)}&pw=${encodeURIComponent(pw)}`);
  });
  return r;
};
