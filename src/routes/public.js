// Pages publiques : formulaire de devis, mini-site, prise de RDV, réponses clients, avis, désinscription, webhooks.
const express = require('express');
const U = require('../util');
const E = require('../engine');
const { publicLayout, head } = require('../views');
const V = require('../visits');
const I = require('../i18n');

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
  const notFound = (res, lang = 'fr') => { const t = I.t(lang); return res.status(404).send(publicLayout(t('not_found'), `<div class="card"><h1>${t('not_found')}</h1><p class="muted">${t('not_found_txt')}</p></div>`, { lang })); };
  const opts = (name, lang, selected) => I.OPTIONS[name].map(([v, nl]) => `<option value="${U.esc(v)}" ${selected === v ? 'selected' : ''}>${U.esc(lang === 'nl' ? nl : v)}</option>`).join('');
  const workOpts = (lang, selected) => WORK_TYPES.map((w) => `<option value="${U.esc(w)}" ${selected === w ? 'selected' : ''}>${U.esc(I.workLabel(w, lang))}</option>`).join('');
  // Lien FR | NL (Belgique uniquement, ou si la page est déjà en néerlandais)
  const langSwitch = (a, lang, path) => (U.countryOf(a) === 'BE' || lang === 'nl' ? `<div class="lang">${['fr', 'nl'].map((l) => (l === lang ? `<b>${l.toUpperCase()}</b>` : `<a href="${path}${path.includes('?') ? '&' : '?'}lang=${l}">${l.toUpperCase()}</a>`)).join(' · ')}</div>` : '');
  const withLang = (url, lang) => (lang === 'nl' ? `${url}${url.includes('?') ? '&' : '?'}lang=nl` : url);

  function quoteForm(a, { embed, action, values = {}, error, lang = 'fr' } = {}) {
    const t = I.t(lang);
    const v = (k) => U.esc(values[k] || '');
    return `<form method="post" action="${action || `/f/${a.slug}`}${embed ? (action && action.includes('?') ? '&' : '?') + 'embed=1' : ''}"><input type="hidden" name="lang" value="${lang}">
${error ? `<div class="flash err">${U.esc(error)}</div>` : ''}
<label>${t('project')} *</label><select name="work_type" required><option value="">${t('choose')}</option>${workOpts(lang, values.work_type)}</select>
<div class="row"><div><label>${t('housing')}</label><select name="housing">${opts('housing', lang, values.housing)}</select></div>
<div><label>${t('energy')}</label><select name="energy">${opts('energy', lang, values.energy)}</select></div></div>
<div class="row"><div><label>${t('surface')}</label><input name="surface" inputmode="numeric" value="${v('surface')}"></div>
<div><label>${t('delay')}</label><select name="delay">${opts('delay', lang, values.delay || 'Dans le mois')}</select></div></div>
<div class="row"><div><label>${t('first_name')} *</label><input name="first_name" required autocomplete="given-name" value="${v('first_name')}"></div><div><label>${t('last_name')}</label><input name="last_name" autocomplete="family-name" value="${v('last_name')}"></div></div>
<div class="row"><div><label>${t('mobile')} *</label><input name="phone" type="tel" required autocomplete="tel" value="${v('phone')}" placeholder="${U.C(a).mobileExample}"></div><div><label>${t('email')}</label><input name="email" type="email" autocomplete="email" value="${v('email')}"></div></div>
<div class="row"><div><label>${t('postal')} *</label><input name="postal_code" required autocomplete="postal-code" value="${v('postal_code')}"></div><div><label>${t('city')}</label><input name="city" value="${v('city')}"></div></div>
${V.picker(db, a, { selected: values.visit || '', lang })}
<label>${t('details')}</label><textarea name="message">${v('message')}</textarea>
<input class="hp" name="website" tabindex="-1" autocomplete="off">
<label class="chk"><input type="checkbox" name="consent" value="1" required> ${U.esc(t('consent', a.company_name))} <a href="${withLang(`/s/${a.slug}/confidentialite`, lang)}" target="_blank">${t('privacy')}</a></label>
<p><button class="btn" style="width:100%">${t('submit_quote')}</button></p></form>`;
  }

  function handleQuote(req, res, a, source) {
    const b = req.body || {};
    const lang = I.pickLang(req, b.lang || 'fr');
    const t = I.t(lang);
    const embed = !!req.query.embed;
    if (b.website) return res.redirect(withLang(`/f/${a.slug}/merci`, lang)); // robot
    if (limited(req.ip)) return res.status(429).send(publicLayout(t('too_many_t'), `<div class="card">${t('too_many')}</div>`, { lang }));
    const phone = U.normalizePhone(b.phone, a.country);
    let error = '';
    if (!b.first_name || !b.work_type || !b.postal_code) error = t('err_required');
    else if (!phone) error = t('err_phone');
    else if (!b.consent) error = t('err_consent');
    else if (b.visit && !V.isAvailable(db, a, b.visit)) { error = t('err_slot'); b.visit = ''; }
    if (error) return res.status(400).send(publicLayout(`${t('quote_title')} · ${a.company_name}`, `<div class="card"><h1>${t('quote_title')}</h1>${quoteForm(a, { embed, values: b, error, lang })}</div>`, { color: a.primary_color, embed, lang }));
    const details = [b.housing && `Logement : ${b.housing}${b.surface ? `, ${b.surface} m²` : ''}`, b.energy && `Chauffage actuel : ${b.energy}`, b.delay && `Délai : ${b.delay}`, lang === 'nl' && 'Langue : néerlandais'].filter(Boolean).join(' · ');
    const lead = E.createLead(db, a, { ...b, phone, lang, visit_at: b.visit || null, message: [details, b.message].filter(Boolean).join('\n'), consent: 1 }, { source });
    res.redirect(`/f/${a.slug}/merci?l=${lead.token}${embed ? '&embed=1' : ''}${lang === 'nl' ? '&lang=nl' : ''}`);
  }

  // ---- Formulaire de devis (lien direct ou intégré en iframe) ----
  r.get('/f/:slug', (req, res) => {
    const lang = I.pickLang(req);
    const a = bySlug(req.params.slug); if (!a) return notFound(res, lang);
    const t = I.t(lang);
    const embed = !!req.query.embed;
    res.send(publicLayout(`${t('quote_title')} · ${a.company_name}`, `<div class="card">${langSwitch(a, lang, `/f/${a.slug}${embed ? '?embed=1' : ''}`)}${embed ? '' : `<div class="muted small">${U.esc(a.company_name)}</div>`}<h1>${t('quote_title')}</h1>
<p class="muted small">${t('quick')}${a.zone ? ` · ${t('zone')} : ${U.esc(a.zone)}` : ''}</p>${quoteForm(a, { embed, lang })}</div>`, { color: a.primary_color, embed, lang }));
  });
  r.post('/f/:slug', (req, res) => { const a = bySlug(req.params.slug); if (!a) return notFound(res); handleQuote(req, res, a, req.query.src === 'site' ? 'site' : 'formulaire'); });
  r.get('/f/:slug/merci', (req, res) => {
    const lang = I.pickLang(req, req.query.lang || 'fr');
    const a = bySlug(req.params.slug); if (!a) return notFound(res, lang);
    const t = I.t(lang);
    const lead = req.query.l ? byToken(req.query.l) : null;
    const visit = lead && lead.account_id === a.id && lead.visit_at ? V.label(lead.visit_at, a, lang) : '';
    res.send(publicLayout(t('thanks'), `<div class="card"><h1>${t('sent')}</h1>${visit ? `<p>${t('visit_booked')} <b>${U.esc(visit)}</b>. ${t('visit_conf')}</p>` : `<p>${U.esc(t('sent_txt', a.company_name))}</p>`}${a.phone ? `<p>${t('urgent')} <a href="tel:${U.esc(a.phone)}">${U.esc(U.displayPhone(a.phone))}</a></p>` : ''}</div>`, { color: a.primary_color, embed: !!req.query.embed, lang }));
  });

  // ---- Mini-site vitrine ----
  r.get('/s/:slug', (req, res) => {
    const lang = I.pickLang(req);
    const a = bySlug(req.params.slug); if (!a) return notFound(res, lang);
    const t = I.t(lang);
    const services = (a.services || 'Installation de pompes à chaleur\nRemplacement de chaudières\nEntretien et dépannage\nChauffe-eau thermodynamique').split('\n').map((s) => s.trim()).filter(Boolean);
    const tel = a.phone ? `<a class="btn" href="tel:${U.esc(a.phone)}">📞 ${U.esc(U.displayPhone(a.phone))}</a>` : '';
    const sw = langSwitch(a, lang, `/s/${a.slug}`);
    res.send(`${head(`${a.company_name} · ${lang === 'nl' ? 'Verwarming' : 'Chauffagiste'} ${a.city || ''}`, a.primary_color, { lang })}<body>
<div class="site-top"><div class="in"><span>${U.esc(a.company_name)}</span><span>${sw ? sw.replace('class="lang"', 'class="lang light"') : ''}${a.phone ? ` <a href="tel:${U.esc(a.phone)}" style="text-decoration:none">${U.esc(U.displayPhone(a.phone))}</a>` : ''}</span></div></div>
<section class="site-hero"><div class="in"><h1>${U.esc(t('site_title', a.city))}</h1>
<p>${U.esc(lang === 'nl' || !a.about ? t('site_about') : a.about)}</p>
<p style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="#devis">${t('site_cta')}</a> ${tel ? tel.replace('class="btn"', 'class="btn sec" style="background:transparent;color:#fff;border-color:#fff"') : ''}</p></div></section>
<section class="site-sec"><div class="in"><h2>${t('services')}</h2><div class="svc">${services.map((s) => `<div>🔧 ${U.esc(s)}</div>`).join('')}</div>
${a.zone ? `<h2>${t('zone_title')}</h2><p>${U.esc(a.zone)}</p>` : ''}
${a.google_review_url ? `<p><a href="${U.esc(a.google_review_url)}" target="_blank" rel="noopener">⭐ ${t('reviews')}</a></p>` : ''}</div></section>
<section class="site-sec alt" id="devis"><div class="in" style="max-width:640px"><h2>${t('quote_title')}</h2>${quoteForm(a, { action: `/f/${a.slug}?src=site`, lang })}</div></section>
<footer class="site">${U.esc(a.company_name)}${a.address ? ' · ' + U.esc(a.address) : ''}${a.siret ? ` · ${U.C(a).bizShort} ` + U.esc(a.siret) : ''}<br><a href="${withLang(`/s/${a.slug}/confidentialite`, lang)}">${t('legal')}</a></footer></body></html>`);
  });
  r.get('/s/:slug/confidentialite', (req, res) => {
    const lang = I.pickLang(req);
    const a = bySlug(req.params.slug); if (!a) return notFound(res, lang);
    const editor = `${a.company_name}${a.address ? ', ' + a.address : ''}${a.siret ? ` · ${U.C(a).bizShort} ${a.siret}` : ''}. Contact : ${a.email}${a.phone ? ' · ' + U.displayPhone(a.phone) : ''}.`;
    const p = I.PRIVACY[lang]({ editor, company: a.company_name, email: a.email, authority: lang === 'nl' ? I.AUTHORITY_NL[U.countryOf(a)] : U.C(a).authority });
    res.send(publicLayout(p.title, `<div class="card"><h1>${p.title}</h1>${p.rows.map(([k, v]) => `<p><b>${U.esc(k)} :</b> ${U.esc(v)}</p>`).join('\n')}</div>`, { color: a.primary_color, lang }));
  });

  // ---- Prise de RDV (lien envoyé après un appel manqué ou un rappel d'entretien) ----
  r.get('/rdv/:slug', (req, res) => {
    const lead = req.query.l ? byToken(req.query.l) : null;
    const lang = I.pickLang(req, req.query.lang ? null : lead && lead.lang);
    const a = bySlug(req.params.slug); if (!a) return notFound(res, lang);
    if (a.booking_url) return res.redirect(a.booking_url);
    const t = I.t(lang);
    // Ancien client qui revient (rappel d'entretien) : on pré-sélectionne l'entretien adapté.
    const pre = lead && lead.status === 'termine' ? (/pompe|clim/i.test(lead.work_type || '') ? 'Entretien ou dépannage pompe à chaleur' : 'Entretien ou dépannage chaudière') : '';
    const pick = V.picker(db, a, { lang });
    const days = []; let d = new Date();
    while (!pick && days.length < 8) { d = U.addDays(d, 1); const p = U.parisParts(d); if (!p.wd.startsWith('dim')) days.push(d.toLocaleDateString(I.locale(lang), { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' })); }
    res.send(publicLayout(`${t('rdv_title')} · ${a.company_name}`, `<div class="card">${langSwitch(a, lang, `/rdv/${a.slug}${req.query.l ? `?l=${encodeURIComponent(req.query.l)}` : ''}`)}<div class="muted small">${U.esc(a.company_name)}</div><h1>${t('rdv_title')}</h1>
<form method="post"><input type="hidden" name="l" value="${U.esc(req.query.l || '')}"><input type="hidden" name="lang" value="${lang}">
<label>${t('need')} *</label><select name="work_type" required>${workOpts(lang, pre)}</select>
${pick || `<div class="row"><div><label>${t('day')}</label><select name="day">${days.map((x) => `<option>${x}</option>`).join('')}</select></div>
<div><label>${t('slot')}</label><select name="slot">${opts('slot', lang)}</select></div></div>`}
<div class="row"><div><label>${t('first_name')} *</label><input name="first_name" required value="${U.esc(lead?.first_name || '')}"></div><div><label>${t('last_name')}</label><input name="last_name" value="${U.esc(lead?.last_name || '')}"></div></div>
<div class="row"><div><label>${t('phone')} *</label><input name="phone" type="tel" required value="${U.esc(U.displayPhone(lead?.phone || ''))}"></div><div><label>${t('postal_city')} *</label><input name="city" required value="${U.esc(lead?.city || '')}"></div></div>
<label>${t('details_short')}</label><textarea name="message"></textarea><input class="hp" name="website" tabindex="-1" autocomplete="off">
<label class="chk"><input type="checkbox" name="consent" value="1" required> ${U.esc(t('rdv_consent', a.company_name))} <a href="${withLang(`/s/${a.slug}/confidentialite`, lang)}" target="_blank">${t('privacy')}</a></label>
<p><button class="btn" style="width:100%">${t('submit')}</button></p></form></div>`, { color: a.primary_color, lang }));
  });
  r.post('/rdv/:slug', (req, res) => {
    const a = bySlug(req.params.slug); if (!a) return notFound(res);
    const b = req.body || {};
    const lang = I.pickLang(req, b.lang || 'fr');
    if (b.website) return res.redirect(withLang(`/f/${a.slug}/merci`, lang));
    if (limited(req.ip)) return res.status(429).send(I.t(lang)('too_many'));
    const phone = U.normalizePhone(b.phone, a.country);
    if (!phone || !b.first_name || !b.consent) return res.redirect(withLang(`/rdv/${a.slug}?l=${encodeURIComponent(b.l || '')}`, lang));
    const visit = b.visit && V.isAvailable(db, a, b.visit) ? b.visit : null;
    const slot = visit ? V.label(visit, a) : b.day ? `${b.day} · ${b.slot || ''}` : 'Rappelez-moi dès que possible';
    const existing = b.l ? byToken(b.l) : null;
    const closed = existing && ['termine', 'accepte', 'refuse', 'perdu'].includes(existing.status);
    if (existing && existing.account_id === a.id && closed) {
      // Ancien client (ex. rappel d'entretien) : nouvelle fiche, l'historique du chantier précédent reste intact.
      E.createLead(db, a, { ...b, phone, lang, email: existing.email, address: existing.address, postal_code: existing.postal_code, last_name: b.last_name || existing.last_name, preferred_slot: slot, visit_at: visit, consent: 1 }, { source: 'rdv' });
    } else if (existing && existing.account_id === a.id) {
      E.updateLead(db, existing.id, { first_name: b.first_name, last_name: b.last_name || '', city: b.city || '', work_type: b.work_type, message: b.message || '', preferred_slot: slot, consent: 1, source: 'rdv', lang });
      E.logEvent(db, a.id, existing.id, 'rdv', `Demande de RDV : ${slot}`);
      if (visit) E.setVisit(db, a, existing.id, visit);
      const who = `${b.first_name} ${b.last_name || ''}`.trim();
      E.notifyArtisan(db, a, existing.id, `📅 ${visit ? 'Visite réservée' : 'Demande de RDV'} : ${who}`, `${who} (${U.displayPhone(phone)}, ${b.city}) demande un RDV : ${slot}.\nBesoin : ${b.work_type}\n${b.message || ''}`.trim());
    } else {
      E.createLead(db, a, { ...b, phone, lang, preferred_slot: slot, visit_at: visit, consent: 1 }, { source: 'rdv' });
    }
    const after = existing && existing.account_id === a.id && !closed ? existing : db.prepare('SELECT * FROM leads WHERE account_id=? ORDER BY id DESC LIMIT 1').get(a.id);
    res.redirect(`/f/${a.slug}/merci${after ? `?l=${after.token}` : '?x=1'}${lang === 'nl' ? '&lang=nl' : ''}`);
  });

  // ---- Réponse du client à une relance ----
  r.get('/c/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res, I.pickLang(req));
    const lang = I.pickLang(req, req.query.lang ? null : lead.lang);
    const t = I.t(lang);
    const a = accountOf(lead);
    const done = lead.client_response;
    const pre = req.query.choix;
    const btn = (v, label, cls) => `<form method="post" style="margin:6px 0"><input type="hidden" name="choix" value="${v}"><input type="hidden" name="lang" value="${lang}"><button class="btn ${cls}" style="width:100%;${pre === v ? 'outline:3px solid #000' : ''}">${label}</button></form>`;
    res.send(publicLayout(`${t('quote')} · ${a.company_name}`, `<div class="card"><div class="muted small">${U.esc(a.company_name)}</div><h1>${t('quote')}${lead.work_type ? ' : ' + U.esc(I.workLabel(lead.work_type, lang)) : ''}</h1>
${lead.quote_amount ? `<p>${t('amount')} : <b>${U.euros(lead.quote_amount)}</b>${lead.quote_ref ? ` · ${t('ref')} ${U.esc(lead.quote_ref)}` : ''}</p>` : ''}
${done ? `<div class="flash">${t('answered')}</div>` : `<p>${t('where')}</p>`}
${btn('ok', t('c_ok'), 'ok')}${btn('rappel', t('c_rappel'), 'sec')}${btn('non', t('c_non'), 'grey')}
${a.phone ? `<p class="small muted">${t('or_call')} <a href="tel:${U.esc(a.phone)}">${U.esc(U.displayPhone(a.phone))}</a></p>` : ''}</div>`, { color: a.primary_color, lang }));
  });
  r.post('/c/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res, I.pickLang(req));
    const lang = I.pickLang(req, lead.lang);
    const t = I.t(lang);
    const c = req.body.choix;
    if (['ok', 'rappel', 'non'].includes(c)) E.clientChoice(db, lead, c);
    const a = accountOf(lead);
    const msg = { ok: t('m_ok'), rappel: t('m_rappel'), non: t('m_non') }[c] || t('thanks');
    res.send(publicLayout(t('thanks'), `<div class="card"><div class="muted small">${U.esc(a.company_name)}</div><h1>${t('thanks')}</h1><p>${msg}</p></div>`, { color: a.primary_color, lang }));
  });

  // ---- Lien d'avis Google (compte les clics puis redirige) ----
  r.get('/avis/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res, I.pickLang(req));
    const a = accountOf(lead);
    if (!lead.review_clicked_at) {
      E.updateLead(db, lead.id, { review_clicked_at: U.iso(new Date()) });
      E.logEvent(db, a.id, lead.id, 'avis', 'Le client a ouvert le lien d\'avis Google');
      db.prepare(`UPDATE messages SET status='annule', error='avis déjà cliqué' WHERE lead_id=? AND kind='avis_relance' AND status='en_attente'`).run(lead.id);
    }
    if (a.google_review_url) return res.redirect(a.google_review_url);
    const t = I.t(lead.lang);
    res.send(publicLayout(t('thanks'), `<div class="card"><h1>${t('thanks')}</h1></div>`, { lang: lead.lang }));
  });

  // ---- Désinscription e-mail ----
  r.get('/desinscription/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res, I.pickLang(req));
    const lang = I.pickLang(req, req.query.lang ? null : lead.lang);
    const t = I.t(lang);
    res.send(publicLayout(t('unsub_t'), `<div class="card"><h1>${t('unsub_h')}</h1><p>${U.esc(t('unsub_txt', accountOf(lead).company_name))}</p><form method="post"><input type="hidden" name="lang" value="${lang}"><button class="btn">${t('unsub_btn')}</button></form></div>`, { lang }));
  });
  r.post('/desinscription/:token', (req, res) => {
    const lead = byToken(req.params.token); if (!lead) return notFound(res, I.pickLang(req));
    const lang = I.pickLang(req, lead.lang);
    const t = I.t(lang);
    E.optOutEmail(db, lead);
    res.send(publicLayout(t('unsub_t'), `<div class="card"><h1>${t('unsub_done_h')}</h1><p>${t('unsub_done')}</p></div>`, { lang }));
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
