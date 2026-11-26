// Le « moteur » : création des demandes, relances, avis, appels manqués, envois programmés.
const U = require('./util');
const { mergeSettings, KINDS, STATUSES } = require('./defaults');
const providers = require('./providers');

const BASE = () => (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const now = () => new Date();

function settingsOf(account) {
  const s = mergeSettings(account.settings);
  s.window.country = U.countryOf(account); // jours fériés du pays de l'artisan
  return s;
}

function logEvent(db, accountId, leadId, type, detail = '') {
  db.prepare('INSERT INTO events (account_id, lead_id, type, detail, created_at) VALUES (?,?,?,?,?)').run(accountId, leadId ?? null, type, detail, U.iso(now()));
}

function varsFor(account, lead = {}) {
  const amount = lead.quote_amount ? U.euros(lead.quote_amount) : '';
  return {
    prenom: lead.first_name || '', nom: lead.last_name || '',
    entreprise: account.company_name, artisan: (account.owner_name || account.company_name || '').split(' ')[0],
    tel: U.displayPhone(account.phone), travaux: lead.work_type || 'vos travaux',
    ref: lead.quote_ref ? `n°${lead.quote_ref}` : '', montant: amount, montant_txt: amount ? `, ${amount}` : '',
    lien: lead.token ? `${BASE()}/c/${lead.token}` : '',
    lien_avis: lead.token ? `${BASE()}/avis/${lead.token}` : account.google_review_url || '',
    lien_rdv: `${BASE()}/rdv/${account.slug}${lead.token ? `?l=${lead.token}` : ''}`,
  };
}
const fill = (tpl, vars) => U.render(tpl, vars).replace(/Bonjour ,/g, 'Bonjour,').replace(/ +/g, ' ').replace(/ \./g, '.').trim();

function emailHtml(account, text, { buttons = [], lead } = {}) {
  const color = account.primary_color || '#d9480f';
  const paras = U.esc(text).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const btns = buttons.map((b) => `<a href="${U.esc(b.href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:600;${b.primary ? `background:${color};color:#fff` : `background:#f1f3f5;color:#212529`}">${U.esc(b.label)}</a>`).join('');
  const unsub = lead && lead.token ? `<a href="${BASE()}/desinscription/${lead.token}" style="color:#868e96">Ne plus recevoir d'e-mails</a>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f8f9fa;font-family:Arial,Helvetica,sans-serif;color:#212529">
<div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px;border-top:5px solid ${color}">
<div style="font-weight:700;font-size:18px;margin-bottom:18px">${U.esc(account.company_name)}</div>${paras}${btns ? `<div style="margin-top:8px">${btns}</div>` : ''}</div>
<div style="font-size:12px;color:#868e96;text-align:center;margin-top:14px">${U.esc(account.company_name)}${account.address ? ' · ' + U.esc(account.address) : ''}<br>${unsub}</div></div></body></html>`;
}

function isOptedOut(db, lead, channel) {
  if (channel === 'sms') {
    if (lead.opt_out_sms) return true;
    return !!db.prepare('SELECT 1 FROM opt_outs WHERE phone = ? LIMIT 1').get(lead.phone || '-');
  }
  if (lead.opt_out_email) return true;
  return !!db.prepare('SELECT 1 FROM opt_outs WHERE email = ? LIMIT 1').get((lead.email || '-').toLowerCase());
}

/** Programme un message. Renvoie l'id ou null si impossible (pas de contact, désinscrit…). */
function schedule(db, account, lead, kind, channel, at, { tplKey, respectWindow = true, window } = {}) {
  const s = settingsOf(account);
  const t = s.templates;
  const vars = varsFor(account, lead);
  let to, body, subject = null, html = null;
  if (channel === 'sms') {
    to = lead.phone;
    if (!to || !U.isMobile(to) || isOptedOut(db, lead, 'sms')) return null;
    body = fill(t[`${tplKey || kind}_sms`], vars);
    if (/^(relance|avis|entretien)/.test(kind) && s.sms_footer) body += ` ${s.sms_footer}`;
  } else {
    to = lead.email;
    if (!to || isOptedOut(db, lead, 'email')) return null;
    const key = tplKey || kind;
    body = fill(t[`${key}_email`], vars);
    subject = fill(t[`${key}_email_subject`], vars);
    let buttons = [];
    if (kind.startsWith('relance')) buttons = [
      { label: '✔ J\'accepte le devis', href: `${vars.lien}?choix=ok`, primary: true },
      { label: 'Rappelez-moi', href: `${vars.lien}?choix=rappel` },
      { label: 'Je ne donne pas suite', href: `${vars.lien}?choix=non` },
    ];
    if (kind.startsWith('avis')) buttons = [{ label: '⭐ Laisser un avis Google', href: vars.lien_avis, primary: true }];
    if (kind === 'entretien') buttons = [{ label: '📅 Choisir un créneau', href: vars.lien_rdv, primary: true }];
    html = emailHtml(account, body, { buttons, lead });
  }
  let when = new Date(at);
  if (respectWindow) when = U.nextAllowed(when, window ? { country: s.window.country, ...window } : s.window);
  const r = db.prepare(`INSERT INTO messages (account_id, lead_id, kind, channel, to_addr, subject, body, html, respect_window, scheduled_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(account.id, lead.id ?? null, kind, channel, to, subject, body, html, respectWindow ? 1 : 0, U.iso(when), U.iso(now()));
  return Number(r.lastInsertRowid);
}

function cancelPending(db, leadId, kindPrefix, reason = 'annulé') {
  db.prepare(`UPDATE messages SET status='annule', error=? WHERE lead_id=? AND status='en_attente' AND kind LIKE ?`).run(reason, leadId, `${kindPrefix}%`);
}

/** Message direct à l'artisan (nouvelle demande, réponse client…). */
function notifyArtisan(db, account, leadId, subject, text) {
  const s = settingsOf(account);
  const ins = db.prepare(`INSERT INTO messages (account_id, lead_id, kind, channel, to_addr, subject, body, html, respect_window, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)`);
  const link = leadId ? `${BASE()}/app/demandes/${leadId}` : `${BASE()}/app`;
  if (s.notif.email && account.email) ins.run(account.id, leadId, 'notif', 'email', account.email, subject, `${text}\n\nVoir la fiche : ${link}`, emailHtml(account, text, { buttons: [{ label: 'Ouvrir la fiche', href: link, primary: true }] }), U.iso(now()), U.iso(now()));
  if (s.notif.sms && U.isMobile(account.phone || '')) ins.run(account.id, leadId, 'notif', 'sms', account.phone, null, `${subject}. ${link}`.slice(0, 300), null, U.iso(now()), U.iso(now()));
}

function getLead(db, id) { return db.prepare('SELECT * FROM leads WHERE id=?').get(id); }

function createLead(db, account, data, { source = 'formulaire', notify = true, confirm = true } = {}) {
  const phone = U.normalizePhone(data.phone, account.country);
  const email = (data.email || '').trim().toLowerCase();
  const r = db.prepare(`INSERT INTO leads (account_id, first_name, last_name, phone, email, address, postal_code, city, work_type, message, preferred_slot, source, status, consent, token, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(account.id, (data.first_name || '').trim(), (data.last_name || '').trim(), phone, email,
    (data.address || '').trim(), (data.postal_code || '').trim(), (data.city || '').trim(), (data.work_type || '').trim(), (data.message || '').trim(),
    (data.preferred_slot || '').trim(), source, data.status || 'nouveau', data.consent ? 1 : 0, U.token(), U.iso(now()), U.iso(now()));
  const lead = getLead(db, Number(r.lastInsertRowid));
  logEvent(db, account.id, lead.id, 'creation', `Demande reçue (${source})`);
  const s = settingsOf(account);
  if (confirm && s.confirmation.enabled) {
    if (s.confirmation.sms) schedule(db, account, lead, 'confirmation', 'sms', now(), { respectWindow: false });
    if (s.confirmation.email) schedule(db, account, lead, 'confirmation', 'email', now(), { respectWindow: false });
  }
  if (notify) {
    const who = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || U.displayPhone(lead.phone) || lead.email;
    notifyArtisan(db, account, lead.id, `Nouvelle demande : ${who}`,
      `Nouvelle demande de ${who}${lead.city ? ' (' + lead.city + ')' : ''}.\nTravaux : ${lead.work_type || '-'}\nTél : ${U.displayPhone(lead.phone) || '-'}\nE-mail : ${lead.email || '-'}\n${lead.preferred_slot ? 'Disponibilités : ' + lead.preferred_slot + '\n' : ''}Message : ${lead.message || '-'}`);
  }
  return lead;
}

function updateLead(db, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE leads SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`).run(...keys.map((k) => fields[k]), U.iso(now()), id);
}

function scheduleRelances(db, account, lead, from = now()) {
  const s = settingsOf(account).relances;
  cancelPending(db, lead.id, 'relance', 'replanifié');
  if (!s.enabled) return 0;
  let n = 0;
  (s.days || []).slice(0, 3).forEach((d, i) => {
    const at = U.addDays(from, Number(d));
    const kind = `relance_${i + 1}`;
    if (s.sms && schedule(db, account, lead, kind, 'sms', at)) n++;
    if (s.email && schedule(db, account, lead, kind, 'email', at)) n++;
  });
  return n;
}

function scheduleReview(db, account, lead, from = now()) {
  const s = settingsOf(account).avis;
  cancelPending(db, lead.id, 'avis', 'replanifié');
  if (!s.enabled) return 0;
  if (!account.google_review_url) { logEvent(db, account.id, lead.id, 'alerte', "Demande d'avis non envoyée : lien Google manquant dans les réglages"); return 0; }
  let n = 0;
  const at = U.addHours(from, Number(s.delay_hours) || 0);
  if (s.sms && schedule(db, account, lead, 'avis', 'sms', at)) n++;
  if (s.email && schedule(db, account, lead, 'avis', 'email', at)) n++;
  if (Number(s.reminder_days) > 0) {
    const r = U.addDays(at, Number(s.reminder_days));
    if (!(s.sms && schedule(db, account, lead, 'avis_relance', 'sms', r)) && s.email) schedule(db, account, lead, 'avis_relance', 'email', r, { tplKey: 'avis' });
    n++;
  }
  updateLead(db, lead.id, { review_requested_at: U.iso(now()) });
  return n;
}

/** Rappel d'entretien N mois après le chantier (puis chaque année tant que le client ne se désinscrit pas). */
function scheduleMaintenance(db, account, lead, from = now()) {
  const s = settingsOf(account).entretien;
  cancelPending(db, lead.id, 'entretien', 'replanifié');
  if (!s.enabled || !(Number(s.months) > 0)) return 0;
  // Un seul rappel en attente par client : on annule ceux d'anciennes fiches du même client.
  const others = db.prepare(`SELECT id FROM leads WHERE account_id=? AND id<>? AND ((phone<>'' AND phone=?) OR (email<>'' AND email=?))`).all(account.id, lead.id, lead.phone || '-', lead.email || '-');
  for (const o of others) cancelPending(db, o.id, 'entretien', 'remplacé par un chantier plus récent');
  const at = addMonths(from, Number(s.months));
  let n = 0;
  if (s.sms && schedule(db, account, lead, 'entretien', 'sms', at)) n++;
  if (s.email && schedule(db, account, lead, 'entretien', 'email', at)) n++;
  return n;
}
function addMonths(d, n) { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }

/** Changement de statut d'une demande : déclenche ou arrête les automatisations. */
function setStatus(db, account, leadId, status, extra = {}) {
  const lead = getLead(db, leadId);
  if (!lead || lead.account_id !== account.id) throw new Error('Demande introuvable');
  const fields = { status, ...extra };
  const t = U.iso(now());
  if (status === 'devis_envoye') { fields.quote_sent_at = t; fields.decided_at = null; fields.client_response = null; }
  if (['accepte', 'refuse', 'perdu'].includes(status)) fields.decided_at = t;
  if (status === 'termine') { fields.completed_at = t; if (!lead.decided_at) fields.decided_at = t; }
  updateLead(db, leadId, fields);
  const fresh = getLead(db, leadId);
  let info = '';
  if (status === 'devis_envoye') info = `${scheduleRelances(db, account, fresh)} relance(s) programmée(s)`;
  else cancelPending(db, leadId, 'relance', 'statut changé');
  if (status === 'termine') {
    info = `${scheduleReview(db, account, fresh)} demande(s) d'avis programmée(s)`;
    const n = scheduleMaintenance(db, account, fresh);
    if (n) info += ` · rappel d'entretien dans ${settingsOf(account).entretien.months} mois`;
  }
  logEvent(db, account.id, leadId, 'statut', `Statut : ${(STATUSES[status] || { label: status }).label}${info ? ' · ' + info : ''}`);
  return getLead(db, leadId);
}

/** Réponse du client via le lien de relance. */
function clientChoice(db, lead, choice) {
  const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(lead.account_id);
  const who = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || U.displayPhone(lead.phone);
  if (choice === 'ok') {
    setStatus(db, account, lead.id, 'accepte', { client_response: 'accepte' });
    notifyArtisan(db, account, lead.id, `🎉 Devis accepté par ${who}`, `${who} a indiqué accepter le devis${lead.quote_amount ? ' de ' + U.euros(lead.quote_amount) : ''}. Appelez-le pour fixer la date : ${U.displayPhone(lead.phone)}`);
  } else if (choice === 'rappel') {
    cancelPending(db, lead.id, 'relance', 'client demande un rappel');
    updateLead(db, lead.id, { client_response: 'rappel' });
    logEvent(db, account.id, lead.id, 'client', 'Le client demande à être rappelé');
    notifyArtisan(db, account, lead.id, `📞 ${who} souhaite être rappelé`, `${who} a une question sur le devis et demande à être rappelé : ${U.displayPhone(lead.phone) || lead.email}`);
  } else if (choice === 'non') {
    setStatus(db, account, lead.id, 'refuse', { client_response: 'refuse' });
    notifyArtisan(db, account, lead.id, `Devis refusé par ${who}`, `${who} a indiqué ne pas donner suite au devis. Les relances sont arrêtées.`);
  }
}

/** Appel manqué : SMS immédiat avec lien de prise de RDV. */
function missedCall(db, account, fromRaw) {
  const s = settingsOf(account);
  const phone = U.normalizePhone(fromRaw, account.country);
  if (!phone) return { ok: false, reason: 'numéro invalide ou masqué' };
  if (!s.appel.enabled) return { ok: false, reason: 'option désactivée' };
  const recent = db.prepare(`SELECT 1 FROM messages WHERE account_id=? AND kind='appel' AND to_addr=? AND created_at > ? LIMIT 1`).get(account.id, phone, U.iso(U.addHours(now(), -24)));
  if (recent) return { ok: true, skipped: 'déjà envoyé dans les dernières 24 h' };
  let lead = db.prepare(`SELECT * FROM leads WHERE account_id=? AND phone=? AND status IN ('nouveau','rdv','devis_envoye') ORDER BY id DESC LIMIT 1`).get(account.id, phone);
  if (!lead) lead = createLead(db, account, { phone, work_type: '' }, { source: 'appel', notify: false, confirm: false });
  logEvent(db, account.id, lead.id, 'appel', `Appel manqué du ${U.displayPhone(phone)}`);
  const id = schedule(db, account, lead, 'appel', 'sms', now(), { window: { start: 8, end: 21, allDays: true } });
  notifyArtisan(db, account, lead.id, `Appel manqué : ${U.displayPhone(phone)}`, `Appel manqué du ${U.displayPhone(phone)}. ${id ? 'Un SMS avec le lien de prise de RDV lui a été envoyé.' : "Aucun SMS envoyé (numéro fixe ou désinscrit) : pensez à rappeler."}`);
  return { ok: true, leadId: lead.id, smsScheduled: !!id };
}

function optOutPhone(db, phoneRaw, accountId = null) {
  const phone = U.normalizePhone(phoneRaw);
  if (!phone) return 0;
  db.prepare('INSERT INTO opt_outs (phone, account_id, created_at) VALUES (?,?,?)').run(phone, accountId, U.iso(now()));
  const leads = db.prepare('SELECT id, account_id FROM leads WHERE phone=?').all(phone);
  for (const l of leads) {
    db.prepare('UPDATE leads SET opt_out_sms=1 WHERE id=?').run(l.id);
    db.prepare(`UPDATE messages SET status='annule', error='STOP' WHERE lead_id=? AND channel='sms' AND status='en_attente'`).run(l.id);
    logEvent(db, l.account_id, l.id, 'rgpd', 'Désinscription SMS (STOP)');
  }
  return leads.length;
}
function optOutEmail(db, lead) {
  if (!lead.email) return;
  db.prepare('INSERT INTO opt_outs (email, account_id, created_at) VALUES (?,?,?)').run(lead.email, lead.account_id, U.iso(now()));
  for (const l of db.prepare('SELECT id FROM leads WHERE email=?').all(lead.email)) {
    db.prepare('UPDATE leads SET opt_out_email=1 WHERE id=?').run(l.id);
    db.prepare(`UPDATE messages SET status='annule', error='désinscription' WHERE lead_id=? AND channel='email' AND status='en_attente'`).run(l.id);
  }
  logEvent(db, lead.account_id, lead.id, 'rgpd', 'Désinscription e-mail');
}

// ---------- Statistiques et bilan mensuel ----------
function stats(db, accountId, from, to) {
  const q = (sql, ...a) => db.prepare(sql).get(accountId, ...a);
  const f = U.iso(from), t = U.iso(to);
  const demandes = q('SELECT COUNT(*) n FROM leads WHERE account_id=? AND created_at>=? AND created_at<?', f, t).n;
  const devis = q('SELECT COUNT(*) n FROM leads WHERE account_id=? AND quote_sent_at>=? AND quote_sent_at<?', f, t).n;
  const signes = q(`SELECT COUNT(*) n, COALESCE(SUM(quote_amount),0) ca FROM leads WHERE account_id=? AND status IN ('accepte','termine') AND decided_at>=? AND decided_at<?`, f, t);
  const signesApresRelance = q(`SELECT COUNT(*) n, COALESCE(SUM(quote_amount),0) ca FROM leads l WHERE account_id=? AND status IN ('accepte','termine') AND decided_at>=? AND decided_at<?
     AND EXISTS (SELECT 1 FROM messages m WHERE m.lead_id=l.id AND m.kind LIKE 'relance%' AND m.status IN ('envoye','simule') AND m.sent_at < l.decided_at)`, f, t);
  const sent = (k) => q(`SELECT COUNT(*) n FROM messages WHERE account_id=? AND kind LIKE ? AND status IN ('envoye','simule') AND sent_at>=? AND sent_at<?`, k, f, t).n;
  const relancesDevis = q(`SELECT COUNT(DISTINCT lead_id) n FROM messages WHERE account_id=? AND kind LIKE 'relance%' AND status IN ('envoye','simule') AND sent_at>=? AND sent_at<?`, f, t).n;
  const clics = q('SELECT COUNT(*) n FROM leads WHERE account_id=? AND review_clicked_at>=? AND review_clicked_at<?', f, t).n;
  const appels = q(`SELECT COUNT(*) n FROM events WHERE account_id=? AND type='appel' AND created_at>=? AND created_at<?`, f, t).n;
  return {
    demandes, devis, signes: signes.n, ca: signes.ca, signesApresRelance: signesApresRelance.n, caApresRelance: signesApresRelance.ca,
    relances: sent('relance%'), devisRelances: relancesDevis, avisDemandes: sent('avis'), avisClics: clics, appels, smsAppel: sent('appel'),
    taux: devis ? Math.round((signes.n / devis) * 100) : 0,
  };
}
function monthRange(ym) { // 'AAAA-MM' -> bornes en heure de Bruxelles/Paris (approx. via UTC+0 minuit local)
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)), end = new Date(Date.UTC(y, m, 1));
  const off = (d) => { const p = U.parisParts(d); return (p.h || 24) % 24; };
  return [new Date(start.getTime() - off(start) * 3600000), new Date(end.getTime() - off(end) * 3600000)];
}
const currentMonth = (d = now()) => { const p = U.parisParts(d); return `${p.y}-${String(p.m).padStart(2, '0')}`; };
const prevMonth = (ym) => { let [y, m] = ym.split('-').map(Number); m--; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); };

function reportText(account, st, ym) {
  return `Bonjour ${(account.owner_name || '').split(' ')[0]},\n\nVoici votre bilan pour ${monthLabel(ym)} :\n\n` +
    `• ${st.demandes} nouvelle(s) demande(s) reçue(s)\n• ${st.appels} appel(s) manqué(s) traité(s) automatiquement\n• ${st.devis} devis envoyé(s)\n` +
    `• ${st.devisRelances} devis relancé(s) automatiquement (${st.relances} messages)\n• ${st.signes} devis signé(s) pour ${U.euros(st.ca)}\n` +
    `• dont ${st.signesApresRelance} signé(s) après relance, soit ${U.euros(st.caApresRelance)}\n• ${st.avisDemandes} demande(s) d'avis Google, ${st.avisClics} client(s) ont cliqué\n\n` +
    `Rapport détaillé : ${BASE()}/app/rapport?mois=${ym}\n\nBonne continuation !`;
}

function monthlyReports(db, at = now()) {
  const p = U.parisParts(at);
  if (p.d !== 1 || p.h < 9) return 0;
  const ym = currentMonth(at), prev = prevMonth(ym);
  let n = 0;
  for (const a of db.prepare(`SELECT * FROM accounts WHERE active=1 AND is_admin=0 AND COALESCE(is_demo,0)=0 AND (last_report_month IS NULL OR last_report_month<>?)`).all(ym)) {
    db.prepare('UPDATE accounts SET last_report_month=? WHERE id=?').run(ym, a.id);
    if (!settingsOf(a).rapport.enabled || !a.email) continue;
    const [f, t] = monthRange(prev);
    const text = reportText(a, stats(db, a.id, f, t), prev);
    db.prepare(`INSERT INTO messages (account_id, kind, channel, to_addr, subject, body, html, respect_window, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?,0,?,?)`)
      .run(a.id, 'rapport', 'email', a.email, `Votre bilan de ${monthLabel(prev)}`, text, emailHtml(a, text, { buttons: [{ label: 'Voir le rapport', href: `${BASE()}/app/rapport?mois=${prev}`, primary: true }] }), U.iso(at), U.iso(at));
    n++;
  }
  return n;
}

// ---------- Envoi des messages arrivés à échéance ----------
let running = false;
async function processDue(db, at = now()) {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    monthlyReports(db, at);
    // Les comptes de démonstration disparaissent au bout de 24 h.
    db.prepare('DELETE FROM accounts WHERE is_demo=1 AND created_at<=?').run(U.iso(U.addHours(at, -24)));
    const due = db.prepare(`SELECT * FROM messages WHERE status='en_attente' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 100`).all(U.iso(at));
    for (const m of due) {
      if (db.prepare('SELECT status FROM messages WHERE id=?').get(m.id)?.status !== 'en_attente') continue; // annulé entre-temps
      const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(m.account_id);
      const lead = m.lead_id ? getLead(db, m.lead_id) : null;
      const cancel = (why) => db.prepare(`UPDATE messages SET status='annule', error=? WHERE id=?`).run(why, m.id);
      if (!account || !account.active) { cancel('compte suspendu'); continue; }
      if (lead && m.kind !== 'notif' && isOptedOut(db, lead, m.channel)) { cancel('désinscrit'); continue; }
      if (lead && m.kind.startsWith('relance') && lead.status !== 'devis_envoye') { cancel('devis plus en attente'); continue; }
      if (lead && m.kind === 'avis_relance' && lead.review_clicked_at) { cancel('avis déjà cliqué'); continue; }
      if (m.respect_window) {
        const s = settingsOf(account);
        if (!U.inWindow(at, s.window)) { db.prepare('UPDATE messages SET scheduled_at=? WHERE id=?').run(U.iso(U.nextAllowed(at, s.window)), m.id); continue; }
      }
      try {
        const res = account.is_demo ? { simulated: true } // un compte démo n'envoie jamais rien pour de vrai
          : m.channel === 'sms' ? await providers.sendSms(account, m.to_addr, m.body, { marketing: /^(relance|avis|entretien)/.test(m.kind) })
          : await providers.sendEmail(account, { to: m.to_addr, subject: m.subject, html: m.html || `<pre>${U.esc(m.body)}</pre>`, text: m.body });
        db.prepare('UPDATE messages SET status=?, sent_at=?, provider_id=? WHERE id=?').run(res.simulated ? 'simule' : 'envoye', U.iso(at), res.id || null, m.id);
        if (lead && m.kind !== 'notif') logEvent(db, account.id, lead.id, 'message', `${KINDS[m.kind] || m.kind} (${m.channel === 'sms' ? 'SMS' : 'e-mail'})${res.simulated ? ' [simulation]' : ''}`);
        n++;
        // Rappel d'entretien envoyé : on programme celui de l'année suivante (une fois par client).
        if (lead && m.kind === 'entretien' && !db.prepare(`SELECT 1 FROM messages WHERE lead_id=? AND kind='entretien' AND status='en_attente'`).get(lead.id)) scheduleMaintenance(db, account, getLead(db, lead.id), at);
      } catch (e) {
        db.prepare(`UPDATE messages SET status='echec', error=? WHERE id=?`).run(String(e.message).slice(0, 500), m.id);
        if (lead) logEvent(db, account.id, lead.id, 'erreur', `Échec d'envoi ${m.channel} : ${e.message}`.slice(0, 300));
      }
    }
  } finally { running = false; }
  return n;
}

function startScheduler(db, everyMs = 60000) {
  const tick = () => processDue(db).catch((e) => console.error('[planificateur]', e));
  setTimeout(tick, 3000);
  return setInterval(tick, everyMs);
}

module.exports = { createLead, setStatus, scheduleMaintenance, addMonths, clientChoice, missedCall, optOutPhone, optOutEmail, processDue, startScheduler, stats, monthRange, currentMonth, prevMonth, monthLabel, reportText, monthlyReports, logEvent, updateLead, getLead, settingsOf, schedule, varsFor, fill, emailHtml, BASE };
