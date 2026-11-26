// Pages publiques : formulaire de devis, mini-site, prise de RDV, réponses clients, avis, désinscription, webhooks.
const express = require('express');
const U = require('../util');
const E = require('../engine');
const { publicLayout, head } = require('../views');

const WORK_TYPES = ['Installation pompe à chaleur', 'Remplacement de chaudière', 'Entretien ou dépannage chaudière', 'Entretien ou dépannage pompe à chaleur',
  'Chauffe-eau / ballon thermodynamique', 'Plancher chauffant / radiateurs', 'Climatisation', 'Autre demande'];

// Anti-abus simple : 8 envois par IP et par heure
const hits = new Map();
function limited(ip) {
  const t = Date.now(), arr = (hits.get(ip) || []).filter((x) => t - x < 3600000);
  arr.push(t); hits.set(ip, arr);
  return arr.length > 8;
}

module.exports = (db) => {
  const r = express.Router();
  const bySlug = (slug) => db.prepare('SELECT * FROM accounts WHERE slug=? AND active=1 AND is_admin=0').get(slug);
  const byToken = (t) => db.prepare('SELECT * FROM leads WHERE token=?').get(t);
  const accountOf = (lead) => db.prepare('SELECT * FROM accounts WHERE id=?').get(lead.account_id);
  const notFound = (res) => res.status(404).send(publicLayout('Page introuvable', '<div class="card"><h1>Page introuvable</h1><p class="muted">Ce lien n\'existe pas ou a expiré.</p></div>'));

  function quoteForm(a, { embed, action, values = {}, error } = {}) {
    const v = (k) => U.esc(values[k] || '');
    return `<form method="post" action="${action || `/f/${a.slug}`}${embed ? '?embed=1' : ''}">
${error ? `<div class="flash err">${U.esc(error)}</div>` : ''}
<label>Votre projet *</label><select name="work_type" required><option value="">Choisir…</option>${WORK_TYPES.map((w) => `<option ${values.work_type === w ? 'selected' : ''}>${w}</option>`).join('')}</select>
<div class="row"><div><label>Type de logement</label><select name="housing"><option>Maison</option><option>Appartement</option><option>Local professionnel</option></select></div>
<div><label>Chauffage actuel</label><select name="energy"><option>Je ne sais pas</option><option>Fioul</option><option>Gaz</option><option>Électrique</option><option>Bois / granulés</option><option>Pompe à chaleur</option></select></div></div>
<div class="row"><div><label>Surface (m²)</label><input name="surface" inputmode="numeric" value="${v('surface')}"></div>
<div><label>Délai souhaité</label><select name="delay"><option>Urgent (panne)</option><option selected>Dans le mois</option><option>Dans les 3 mois</option><option>Je me renseigne</option></select></div></div>
<div class="row"><div><label>Prénom *</label><input name="first_name" required value="${v('first_name')}"></div><div><label>Nom</label><input name="last_name" value="${v('last_name')}"></div></div>
<div class="row"><div><label>Téléphone mobile *</label><input name="phone" type="tel" required value="${v('phone')}" placeholder="${U.C(a).mobileExample}"></div><div><label>E-mail</label><input name="email" type="email" value="${v('email')}"></div></div>
<div class="row"><div><label>Code postal *</label><input name="postal_code" required value="${v('postal_code')}"></div><div><label>Ville</label><input name="city" value="${v('city')}"></div></div>
<label>Précisions (marque, problème, disponibilités…)</label><textarea name="message">${v('message')}</textarea>
<input class="hp" name="website" tabindex="-1" autocomplete="off">
<label class="chk"><input type="checkbox" name="consent" value="1" required> J'accepte que ${U.esc(a.company_name)} me recontacte par téléphone, SMS ou e-mail au sujet de ma demande. <a href="/s/${a.slug}/confidentialite" target="_blank">Données personnelles</a></label>
<p><button class="btn" style="width:100%">Recevoir mon devis gratuit</button></p></form>`;
  }

  function handleQuote(req, res, a, source) {
    const b = req.body || {};
    const embed = !!req.query.embed;
    if (b.website) return res.redirect(`/f/${a.slug}/merci`); // robot
    if (limited(req.ip)) return res.status(429).send(publicLayout('Trop de demandes', '<div class="card">Trop de demandes envoyées. Réessayez plus tard ou appelez-nous.</div>'));
    const phone = U.normalizePhone(b.phone, a.country);
    let error = '';
    if (!b.first_name || !b.work_type || !b.postal_code) error = 'Merci de remplir les champs obligatoires.';
    else if (!phone) error = 'Le numéro de téléphone semble incorrect.';
    else if (!b.consent) error = 'Merci de cocher la case de consentement.';
    if (error) return res.status(400).send(publicLayout(`Demande de devis · ${a.company_name}`, `<div class="card"><h1>Demande de devis gratuit</h1>${quoteForm(a, { embed, values: b, error })}</div>`, { color: a.primary_color, embed }));
    const details = [b.housing && `Logement : ${b.housing}${b.surface ? `, ${b.surface} m²` : ''}`, b.energy && `Chauffage actuel : ${b.energy}`, b.delay && `Délai : ${b.delay}`].filter(Boolean).join(' · ');
    E.createLead(db, a, { ...b, phone, message: [details, b.message].filter(Boolean).join('\n'), consent: 1 }, { source });
    res.redirect(`/f/${a.slug}/merci${embed ? '?embed=1' : ''}`);
  }

  // ---- Formulaire de devis (lien direct ou intégré en iframe) ----
  r.get('/f/:slug', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return notFound(res);
    const embed = !!req.query.embed;
    res.send(publicLayout(`Demande de devis · ${a.company_name}`, `<div class="card">${embed ? '' : `<div class="muted small">${U.esc(a.company_name)}</div>`}<h1>Demande de devis gratuit</h1>
<p class="muted small">Réponse rapide${a.zone ? ` · Intervention : ${U.esc(a.zone)}` : ''}</p>${quoteForm(a, { embed })}</div>`, { color: a.primary_color, embed }));
  });
  r.post('/f/:slug', (req, res) => { const a = bySlug(req.params.slug); if (!a) return notFound(res); handleQuote(req, res, a, req.query.src === 'site' ? 'site' : 'formulaire'); });
  r.get('/f/:slug/merci', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return notFound(res);
    res.send(publicLayout('Merci !', `<div class="card"><h1>✅ Demande envoyée !</h1><p>Merci, ${U.esc(a.company_name)} a bien reçu votre demande et vous recontacte très vite.</p>${a.phone ? `<p>Pour une urgence : <a href="tel:${U.esc(a.phone)}">${U.esc(U.displayPhone(a.phone))}</a></p>` : ''}</div>`, { color: a.primary_color, embed: !!req.query.embed }));
  });

  // ---- Mini-site vitrine ----
  r.get('/s/:slug', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return notFound(res);
    const services = (a.services || 'Installation de pompes à chaleur\nRemplacement de chaudières\nEntretien et dépannage\nChauffe-eau thermodynamique').split('\n').map((s) => s.trim()).filter(Boolean);
    const tel = a.phone ? `<a class="btn" href="tel:${U.esc(a.phone)}">📞 ${U.esc(U.displayPhone(a.phone))}</a>` : '';
    res.send(`${head(`${a.company_name} · Chauffagiste ${a.city || ''}`, a.primary_color)}<body>
<div class="site-top"><div class="in"><span>${U.esc(a.company_name)}</span>${a.phone ? `<a href="tel:${U.esc(a.phone)}" style="text-decoration:none">${U.esc(U.displayPhone(a.phone))}</a>` : ''}</div></div>
<section class="site-hero"><div class="in"><h1>Votre chauffagiste ${a.city ? 'à ' + U.esc(a.city) : 'de confiance'}</h1>
<p>${U.esc(a.about || 'Installation, remplacement et entretien de votre chauffage. Devis gratuit et rapide, intervention soignée.')}</p>
<p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="#devis">Demander un devis gratuit</a> ${tel ? tel.replace('class="btn"', 'class="btn sec" style="background:transparent;color:#fff;border-color:#fff"') : ''}</p></div></section>
<section class="site-sec"><div class="in"><h2>Nos prestations</h2><div class="svc">${services.map((s) => `<div>🔧 ${U.esc(s)}</div>`).join('')}</div>
${a.zone ? `<h2>Zone d'intervention</h2><p>${U.esc(a.zone)}</p>` : ''}
${a.google_review_url ? `<p><a href="${U.esc(a.google_review_url)}" target="_blank" rel="noopener">⭐ Voir nos avis clients sur Google</a></p>` : ''}</div></section>
<section class="site-sec alt" id="devis"><div class="in" style="max-width:640px"><h2>Demande de devis gratuit</h2>${quoteForm(a, { action: `/f/${a.slug}?src=site` }).replace('?src=site?embed=1', '?src=site')}</div></section>
<footer class="site">${U.esc(a.company_name)}${a.address ? ' · ' + U.esc(a.address) : ''}${a.siret ? ` · ${U.C(a).bizShort} ` + U.esc(a.siret) : ''}<br><a href="/s/${a.slug}/confidentialite">Mentions légales et données personnelles</a></footer></body></html>`);
  });
  r.get('/s/:slug/confidentialite', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return notFound(res);
    res.send(publicLayout('Données personnelles', `<div class="card"><h1>Mentions légales et données personnelles</h1>
<p><b>Éditeur :</b> ${U.esc(a.company_name)}${a.address ? ', ' + U.esc(a.address) : ''}${a.siret ? ` · ${U.C(a).bizShort} ` + U.esc(a.siret) : ''}. Contact : ${U.esc(a.email)}${a.phone ? ' · ' + U.esc(U.displayPhone(a.phone)) : ''}.</p>
<p><b>Données collectées :</b> nom, prénom, téléphone, e-mail, adresse et description de votre projet, uniquement pour répondre à votre demande (devis, prise de rendez-vous, suivi de votre devis, demande d'avis après intervention).</p>
<p><b>Base légale :</b> votre consentement et les mesures précontractuelles prises à votre demande.</p>
<p><b>Durée de conservation :</b> 3 ans après le dernier contact, puis suppression.</p>
<p><b>Destinataires :</b> ${U.esc(a.company_name)} et ses sous-traitants techniques (hébergement, envoi de SMS et d'e-mails), situés dans l'Union européenne. Vos données ne sont jamais vendues.</p>
<p><b>Vos droits :</b> accès, rectification, effacement, opposition. Écrivez à ${U.esc(a.email)}. Vous pouvez répondre STOP à tout SMS et utiliser le lien de désinscription présent dans chaque e-mail. Vous pouvez aussi introduire une réclamation auprès de ${U.esc(U.C(a).authority)}.</p></div>`, { color: a.primary_color }));
  });

  // ---- Prise de RDV (lien envoyé après un appel manqué) ----
  r.get('/rdv/:slug', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return notFound(res);
    if (a.booking_url) return res.redirect(a.booking_url);
    const lead = req.query.l ? byToken(req.query.l) : null;
    // Ancien client qui revient (rappel d'entretien) : on pré-sélectionne l'entretien adapté.
    const pre = lead && lead.status === 'termine' ? (/pompe|clim/i.test(lead.work_type || '') ? 'Entretien ou dépannage pompe à chaleur' : 'Entretien ou dépannage chaudière') : '';
    const days = []; let d = new Date();
    while (days.length < 8) { d = U.addDays(d, 1); const p = U.parisParts(d); if (!p.wd.startsWith('dim')) days.push(d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })); }
    res.send(publicLayout(`Rendez-vous · ${a.company_name}`, `<div class="card"><div class="muted small">${U.esc(a.company_name)}</div><h1>Être rappelé ou prendre rendez-vous</h1>
<form method="post"><input type="hidden" name="l" value="${U.esc(req.query.l || '')}">
<label>Votre besoin *</label><select name="work_type" required>${WORK_TYPES.map((w) => `<option ${w === pre ? 'selected' : ''}>${w}</option>`).join('')}</select>
<div class="row"><div><label>Jour souhaité</label><select name="day">${days.map((x) => `<option>${x}</option>`).join('')}</select></div>
<div><label>Créneau</label><select name="slot"><option>Matin (8h-12h)</option><option>Après-midi (13h-18h)</option><option>Rappelez-moi dès que possible</option></select></div></div>
<div class="row"><div><label>Prénom *</label><input name="first_name" required value="${U.esc(lead?.first_name || '')}"></div><div><label>Nom</label><input name="last_name" value="${U.esc(lead?.last_name || '')}"></div></div>
<div class="row"><div><label>Téléphone *</label><input name="phone" required value="${U.esc(U.displayPhone(lead?.phone || ''))}"></div><div><label>Code postal / ville *</label><input name="city" required value="${U.esc(lead?.city || '')}"></div></div>
<label>Précisions</label><textarea name="message"></textarea><input class="hp" name="website" tabindex="-1" autocomplete="off">
<label class="chk"><input type="checkbox" name="consent" value="1" required> J'accepte d'être recontacté par ${U.esc(a.company_name)} au sujet de ma demande. <a href="/s/${a.slug}/confidentialite" target="_blank">Données personnelles</a></label>
<p><button class="btn" style="width:100%">Envoyer ma demande</button></p></form></div>`, { color: a.primary_color }));
  });
  r.post('/rdv/:slug', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return notFound(res);
    const b = req.body || {};
    if (b.website) return res.redirect(`/f/${a.slug}/merci`);
    if (limited(req.ip)) return res.status(429).send('Trop de demandes');
    const phone = U.normalizePhone(b.phone, a.country);
    if (!phone || !b.first_name || !b.consent) return res.redirect(`/rdv/${a.slug}?l=${encodeURIComponent(b.l || '')}`);
    const slot = `${b.day || ''} · ${b.slot || ''}`;
    const existing = b.l ? byToken(b.l) : null;
    const closed = existing && ['termine', 'accepte', 'refuse', 'perdu'].includes(existing.status);
    if (existing && existing.account_id === a.id && closed) {
      // Ancien client (ex. rappel d'entretien) : nouvelle fiche, l'historique du chantier précédent reste intact.
      E.createLead(db, a, { ...b, phone, email: existing.email, address: existing.address, postal_code: existing.postal_code, last_name: b.last_name || existing.last_name, preferred_slot: slot, consent: 1 }, { source: 'rdv' });
    } else if (existing && existing.account_id === a.id) {
      E.updateLead(db, existing.id, { first_name: b.first_name, last_name: b.last_name || '', city: b.city || '', work_type: b.work_type, message: b.message || '', preferred_slot: slot, consent: 1, source: 'rdv' });
      E.logEvent(db, a.id, existing.id, 'rdv', `Demande de RDV : ${slot}`);
      const who = `${b.first_name} ${b.last_name || ''}`.trim();
      const st = E.settingsOf(a);
      const ins = (ch, to, subj, body) => db.prepare(`INSERT INTO messages (account_id, lead_id, kind, channel, to_addr, subject, body, html, respect_window, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)`).run(a.id, existing.id, 'notif', ch, to, subj, body, ch === 'email' ? E.emailHtml(a, body, { buttons: [{ label: 'Ouvrir la fiche', href: `${E.BASE()}/app/demandes/${existing.id}`, primary: true }] }) : null, U.iso(new Date()), U.iso(new Date()));
      const txt = `${who} (${U.displayPhone(phone)}, ${b.city}) demande un RDV : ${slot}. Besoin : ${b.work_type}. ${b.message || ''}`;
      if (st.notif.email) ins('email', a.email, `📅 Demande de RDV : ${who}`, txt);
      if (st.notif.sms && U.isMobile(a.phone || '')) ins('sms', a.phone, null, `RDV demandé : ${txt}`.slice(0, 300));
    } else {
      E.createLead(db, a, { ...b, phone, preferred_slot: slot, consent: 1 }, { source: 'rdv' });
    }
    res.redirect(`/f/${a.slug}/merci`);
  });

  // ---- Réponse du client à une relance ----
  r.get('/c/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res);
    const a = accountOf(lead);
    const done = lead.client_response;
    const pre = req.query.choix;
    const btn = (v, label, cls) => `<form method="post" style="margin:6px 0"><input type="hidden" name="choix" value="${v}"><button class="btn ${cls}" style="width:100%;${pre === v ? 'outline:3px solid #000' : ''}">${label}</button></form>`;
    res.send(publicLayout(`Votre devis · ${a.company_name}`, `<div class="card"><div class="muted small">${U.esc(a.company_name)}</div><h1>Votre devis${lead.work_type ? ' : ' + U.esc(lead.work_type) : ''}</h1>
${lead.quote_amount ? `<p>Montant : <b>${U.euros(lead.quote_amount)}</b>${lead.quote_ref ? ` · Réf. ${U.esc(lead.quote_ref)}` : ''}</p>` : ''}
${done ? `<div class="flash">Votre réponse a bien été prise en compte. Merci !</div>` : `<p>Dites-nous simplement où vous en êtes :</p>`}
${btn('ok', "✔ J'accepte le devis, contactez-moi pour fixer la date", 'ok')}${btn('rappel', "📞 J'ai une question, rappelez-moi", 'sec')}${btn('non', 'Je ne donne pas suite', 'grey')}
${a.phone ? `<p class="small muted">Ou appelez directement le <a href="tel:${U.esc(a.phone)}">${U.esc(U.displayPhone(a.phone))}</a></p>` : ''}</div>`, { color: a.primary_color }));
  });
  r.post('/c/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res);
    const c = req.body.choix;
    if (['ok', 'rappel', 'non'].includes(c)) E.clientChoice(db, lead, c);
    const a = accountOf(lead);
    const msg = { ok: 'Merci pour votre confiance ! Nous vous appelons très vite pour fixer la date d\'intervention.', rappel: 'C\'est noté, nous vous rappelons rapidement.', non: 'C\'est noté, merci de nous avoir répondu. Nous ne vous relancerons plus.' }[c] || 'Merci.';
    res.send(publicLayout('Merci', `<div class="card"><div class="muted small">${U.esc(a.company_name)}</div><h1>Merci !</h1><p>${msg}</p></div>`, { color: a.primary_color }));
  });

  // ---- Lien d'avis Google (compte les clics puis redirige) ----
  r.get('/avis/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res);
    const a = accountOf(lead);
    if (!lead.review_clicked_at) {
      E.updateLead(db, lead.id, { review_clicked_at: U.iso(new Date()) });
      E.logEvent(db, a.id, lead.id, 'avis', 'Le client a ouvert le lien d\'avis Google');
      db.prepare(`UPDATE messages SET status='annule', error='avis déjà cliqué' WHERE lead_id=? AND kind='avis_relance' AND status='en_attente'`).run(lead.id);
    }
    if (a.google_review_url) return res.redirect(a.google_review_url);
    res.send(publicLayout('Merci', '<div class="card"><h1>Merci !</h1></div>'));
  });

  // ---- Désinscription e-mail ----
  r.get('/desinscription/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res);
    res.send(publicLayout('Désinscription', `<div class="card"><h1>Ne plus recevoir d'e-mails</h1><p>Vous ne recevrez plus d'e-mails de ${U.esc(accountOf(lead).company_name)}.</p><form method="post"><button class="btn">Confirmer la désinscription</button></form></div>`));
  });
  r.post('/desinscription/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res);
    E.optOutEmail(db, lead);
    res.send(publicLayout('Désinscription', '<div class="card"><h1>C\'est fait</h1><p>Votre désinscription est enregistrée.</p></div>'));
  });

  // ---- Webhooks ----
  const byWebhook = (t) => db.prepare('SELECT * FROM accounts WHERE webhook_token=? AND active=1').get(t);
  const pick = (o, keys) => { for (const k of keys) if (o && o[k]) return String(o[k]); return ''; };
  const callerKeys = ['from', 'From', 'caller', 'numero', 'number', 'phone', 'callerNumber', 'caller_id'];

  // Appel manqué générique (Make/Zapier, standard téléphonique, application mobile…)
  r.all('/webhooks/appel-manque/:token', (req, res) => {
    const a = byWebhook(req.params.token); if (!a) return res.status(404).json({ ok: false });
    const out = E.missedCall(db, a, pick({ ...req.query, ...req.body }, callerKeys));
    E.processDue(db).catch(() => {});
    res.json(out);
  });
  // Twilio : renvoi d'appel sur non-réponse vers un numéro Twilio -> message vocal + SMS
  r.post('/webhooks/twilio/voix/:token', (req, res) => {
    const a = byWebhook(req.params.token);
    res.type('text/xml');
    if (!a) return res.send('<Response><Hangup/></Response>');
    E.missedCall(db, a, pick(req.body, ['From', 'Caller']));
    E.processDue(db).catch(() => {});
    const say = U.esc(E.fill(E.settingsOf(a).templates.appel_vocal, E.varsFor(a)));
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say language="fr-FR" voice="Polly.Lea">${say}</Say><Hangup/></Response>`);
  });
  // SMS entrants (réponse STOP) : Brevo, Twilio ou autre
  r.all('/webhooks/sms-entrant', (req, res) => {
    if (process.env.INBOUND_KEY && req.query.key !== process.env.INBOUND_KEY) return res.status(403).json({ ok: false });
    const src = { ...req.query, ...req.body };
    const from = pick(src, ['From', 'from', 'msisdn', 'sender', 'phone', 'number']);
    const text = pick(src, ['Body', 'text', 'message', 'content', 'body']);
    let n = 0;
    if (/^\s*(stop|arret|arrêt|desabonner|désabonner|unsubscribe)\b/i.test(text)) n = E.optOutPhone(db, from);
    if (req.body && req.body.From && req.body.Body) return res.type('text/xml').send('<Response></Response>');
    res.json({ ok: true, optedOut: n });
  });

  return r;
};
module.exports.WORK_TYPES = WORK_TYPES;
