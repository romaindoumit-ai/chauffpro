// Espace artisan.
const express = require('express');
const U = require('../util');
const E = require('../engine');
const { appLayout, badge, fullName } = require('../views');
const { STATUSES, SOURCES, KINDS, DEFAULT_SETTINGS } = require('../defaults');
const { WORK_TYPES } = require('./public');

const MSG_STATUS = { en_attente: ['Programmé', '#1c7ed6'], envoye: ['Envoyé', '#2f9e44'], simule: ['Simulé', '#7048e8'], echec: ['Échec', '#e03131'], annule: ['Annulé', '#adb5bd'] };
const mbadge = (s) => { const [l, c] = MSG_STATUS[s] || [s, '#868e96']; return `<span class="badge" style="background:${c}">${l}</span>`; };
const back = (res, url, ok) => res.redirect(`${url}${url.includes('?') ? '&' : '?'}ok=${encodeURIComponent(ok)}`);

module.exports = (db) => {
  const r = express.Router();
  const lead = (req) => { const l = db.prepare('SELECT * FROM leads WHERE id=? AND account_id=?').get(req.params.id, req.account.id); return l; };

  // ---------- Tableau de bord ----------
  r.get('/', (req, res) => {
    const a = req.account;
    const ym = E.currentMonth();
    const [f, t] = E.monthRange(ym);
    const st = E.stats(db, a.id, f, t);
    const todo = db.prepare(`SELECT * FROM leads WHERE account_id=? AND (status='nouveau' OR client_response='rappel' AND status='devis_envoye') ORDER BY created_at DESC LIMIT 15`).all(a.id);
    const pipeline = db.prepare(`SELECT status, COUNT(*) n, COALESCE(SUM(quote_amount),0) s FROM leads WHERE account_id=? GROUP BY status`).all(a.id);
    const pipe = Object.fromEntries(pipeline.map((p) => [p.status, p]));
    const next = db.prepare(`SELECT m.*, l.first_name, l.last_name, l.phone, l.email FROM messages m LEFT JOIN leads l ON l.id=m.lead_id WHERE m.account_id=? AND m.status='en_attente' AND m.kind<>'notif' ORDER BY m.scheduled_at LIMIT 8`).all(a.id);
    const kpi = (v, l) => `<div class="card kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const setup = [];
    if (!require('../push').count(db, a.id)) setup.push('📲 <a href="/app/appli">Installez l\'appli sur votre téléphone</a> pour être prévenu à chaque nouvelle demande.');
    if (!a.google_review_url) setup.push('<a href="/app/reglages">Ajoutez votre lien d\'avis Google</a> pour activer les demandes d\'avis.');
    if (!a.phone) setup.push('<a href="/app/reglages">Ajoutez votre numéro</a> pour qu\'il apparaisse dans les messages.');
    res.send(appLayout(req, 'Tableau de bord', `<h1>Bonjour ${U.esc((a.owner_name || '').split(' ')[0])} 👋</h1>
${setup.length ? `<div class="banner">${setup.join('<br>')}</div>` : ''}
<div class="grid g4">${kpi(st.demandes, 'demandes ce mois-ci')}${kpi(st.devis, 'devis envoyés')}${kpi(st.relances, 'relances envoyées')}${kpi(`${st.signes} <small style="font-size:15px">(${U.euros(st.ca)})</small>`, 'devis signés')}
${kpi(st.signesApresRelance, 'signés après relance')}${kpi(st.appels, 'appels manqués traités')}${kpi(st.avisDemandes, 'avis demandés')}${kpi(st.avisClics, 'clics vers Google')}</div>
<div class="grid g2" style="margin-top:14px">
<div><h2>À traiter</h2>${todo.length ? `<table>${todo.map((l) => `<tr class="click" onclick="location='/app/demandes/${l.id}'"><td><b>${fullName(l)}</b><div class="small muted">${U.esc(l.work_type || SOURCES[l.source] || '')}</div></td><td>${l.client_response === 'rappel' ? '<span class="badge" style="background:#e8590c">À rappeler</span>' : badge(l.status)}<div class="small muted">${U.frDate(l.created_at)}</div></td></tr>`).join('')}</table>` : '<div class="card muted">Rien à traiter pour l\'instant.</div>'}</div>
<div><h2>Devis en cours</h2><div class="card">${['devis_envoye', 'accepte', 'termine'].map((s) => `<div class="row" style="padding:6px 0"><div>${badge(s)}</div><div class="right"><b>${pipe[s]?.n || 0}</b> · ${U.euros(pipe[s]?.s || 0)}</div></div>`).join('')}</div>
<h2>Prochains envois automatiques</h2>${next.length ? `<table>${next.map((m) => `<tr><td>${U.esc(KINDS[m.kind] || m.kind)} <span class="pill">${m.channel === 'sms' ? 'SMS' : 'e-mail'}</span><div class="small muted">${U.esc([m.first_name, m.last_name].filter(Boolean).join(' ') || m.to_addr)}</div></td><td class="small">${U.frDate(m.scheduled_at)}</td></tr>`).join('')}</table>` : '<div class="card muted">Aucun envoi programmé.</div>'}</div></div>
<p style="margin-top:18px"><a class="btn" href="/app/demandes/nouvelle">+ Ajouter un devis / une demande</a></p>`, 'home'));
  });

  // ---------- Liste des demandes ----------
  r.get('/demandes', (req, res) => {
    const a = req.account;
    const s = req.query.statut || '';
    const q = (req.query.q || '').trim();
    let sql = 'SELECT * FROM leads WHERE account_id=?'; const args = [a.id];
    if (s === 'rappel') sql += " AND client_response='rappel' AND status='devis_envoye'";
    else if (s) { sql += ' AND status=?'; args.push(s); }
    if (q) { sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ? OR city LIKE ? OR quote_ref LIKE ?)'; const like = `%${q}%`; args.push(like, like, `%${q.replace(/^0/, '')}%`, like, like, like); }
    const rows = db.prepare(sql + ' ORDER BY updated_at DESC LIMIT 300').all(...args);
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM leads WHERE account_id=? GROUP BY status').all(a.id).map((x) => [x.status, x.n]));
    const tab = (v, l) => `<a class="${s === v ? 'on' : ''}" href="/app/demandes${v ? '?statut=' + v : ''}">${l}${v && counts[v] ? ` (${counts[v]})` : ''}</a>`;
    res.send(appLayout(req, 'Demandes', `<div class="row"><h1 style="flex:3">Demandes & devis</h1><div class="right"><a class="btn" href="/app/demandes/nouvelle">+ Nouvelle</a> <a class="btn sec" href="/app/export.csv">Export CSV</a></div></div>
<div class="tabs">${tab('', 'Toutes')}${Object.entries(STATUSES).map(([k, v]) => tab(k, v.label.replace(' (relances actives)', ''))).join('')}${tab('rappel', 'À rappeler')}</div>
<form class="row noprint" style="margin-bottom:12px"><input name="q" value="${U.esc(q)}" placeholder="Rechercher un nom, téléphone, ville, n° de devis…">${s ? `<input type="hidden" name="statut" value="${U.esc(s)}">` : ''}<div style="flex:0"><button class="btn sec">Rechercher</button></div></form>
${rows.length ? `<table><tr><th>Client</th><th>Projet</th><th>Statut</th><th>Montant</th><th>Mise à jour</th></tr>${rows.map((l) => `<tr class="click" onclick="location='/app/demandes/${l.id}'"><td><b>${fullName(l)}</b><div class="small muted">${U.esc(U.displayPhone(l.phone))} ${U.esc(l.city || l.postal_code || '')}</div></td><td>${U.esc(l.work_type || '')}<div class="small muted">${U.esc(SOURCES[l.source] || l.source)}</div></td><td>${badge(l.status)}${l.client_response === 'rappel' ? ' <span class="badge" style="background:#e8590c">À rappeler</span>' : ''}</td><td>${U.euros(l.quote_amount)}</td><td class="small">${U.frDate(l.updated_at)}</td></tr>`).join('')}</table>` : '<div class="card muted">Aucune demande.</div>'}`, 'demandes'));
  });

  // ---------- Nouvelle demande (saisie manuelle, ex. devis fait sur place) ----------
  r.get('/demandes/nouvelle', (req, res) => {
    res.send(appLayout(req, 'Nouvelle demande', `<h1>Ajouter un client / un devis</h1><div class="card" style="max-width:720px"><form method="post" action="/app/demandes">
<div class="row"><div><label>Prénom</label><input name="first_name"></div><div><label>Nom</label><input name="last_name"></div></div>
<div class="row"><div><label>Mobile</label><input name="phone" placeholder="${U.C(req.account).mobileExample}"></div><div><label>E-mail</label><input name="email" type="email"></div></div>
<div class="row"><div><label>Adresse</label><input name="address"></div><div><label>Code postal</label><input name="postal_code"></div><div><label>Ville</label><input name="city"></div></div>
<label>Projet</label><select name="work_type">${WORK_TYPES.map((w) => `<option>${w}</option>`).join('')}</select>
<label>Notes</label><textarea name="message"></textarea>
<h2>Le devis est déjà envoyé ?</h2><p class="small muted">Si vous remplissez le montant, la demande passe en « Devis envoyé » et les relances automatiques démarrent.</p>
<div class="row"><div><label>Montant ${U.C(req.account).tax} (€)</label><input name="quote_amount" inputmode="decimal"></div><div><label>N° de devis</label><input name="quote_ref"></div></div>
<h2>Ancien client à recontacter pour l'entretien ?</h2><p class="small muted">Indiquez la date de votre dernier passage : la fiche est classée « Chantier terminé » (sans demande d'avis) et le rappel d'entretien part ${E.settingsOf(req.account).entretien.months} mois après cette date.</p>
<div class="row"><div><label>Dernier passage le</label><input name="last_service" type="date" max="${new Date().toISOString().slice(0, 10)}"></div><div></div></div>
<label class="chk"><input type="checkbox" name="consent" value="1" checked> Le client a accepté d'être recontacté (SMS / e-mail) au sujet de ce devis.</label>
<p><button class="btn">Enregistrer</button></p></form></div>`, 'demandes'));
  });
  r.post('/demandes', (req, res) => {
    const a = req.account, b = req.body;
    if (!b.phone && !b.email && !b.last_name && !b.first_name) return res.redirect('/app/demandes/nouvelle?err=' + encodeURIComponent('Indiquez au moins un nom, un téléphone ou un e-mail.'));
    const l = E.createLead(db, a, { ...b, consent: b.consent ? 1 : 0 }, { source: 'manuel', notify: false, confirm: false });
    const amount = parseFloat(String(b.quote_amount || '').replace(/\s/g, '').replace(',', '.'));
    const last = /^\d{4}-\d{2}-\d{2}$/.test(b.last_service || '') ? new Date(`${b.last_service}T10:00:00Z`) : null;
    if (last && !(amount > 0)) {
      E.updateLead(db, l.id, { status: 'termine', completed_at: U.iso(last), decided_at: U.iso(last) });
      const n = E.scheduleMaintenance(db, a, E.getLead(db, l.id), last);
      E.logEvent(db, a.id, l.id, 'statut', `Ancien client ajouté (dernier passage le ${U.frDate(U.iso(last), false)})${n ? ' · rappel d\'entretien programmé' : ''}`);
      return back(res, `/app/demandes/${l.id}`, n ? "Client enregistré, le rappel d'entretien est programmé." : "Client enregistré (rappel d'entretien désactivé ou pas de coordonnées).");
    }
    if (amount > 0) E.setStatus(db, a, l.id, 'devis_envoye', { quote_amount: amount, quote_ref: b.quote_ref || null });
    back(res, `/app/demandes/${l.id}`, amount > 0 ? 'Devis enregistré, les relances automatiques sont programmées.' : 'Demande enregistrée.');
  });

  // ---------- Fiche demande ----------
  r.get('/demandes/:id', (req, res) => {
    const l = lead(req); if (!l) return res.redirect('/app/demandes');
    const msgs = db.prepare('SELECT * FROM messages WHERE lead_id=? ORDER BY scheduled_at DESC').all(l.id);
    const evs = db.prepare('SELECT * FROM events WHERE lead_id=? ORDER BY id DESC').all(l.id);
    const act = (status, label, cls = 'sec') => `<form method="post" action="/app/demandes/${l.id}/statut"><input type="hidden" name="status" value="${status}"><button class="btn sm ${cls}">${label}</button></form>`;
    const f = (k, label, type = 'text') => `<div><label>${label}</label><input name="${k}" type="${type}" value="${U.esc(k === 'phone' ? U.displayPhone(l[k]) : l[k] ?? '')}"></div>`;
    res.send(appLayout(req, fullName(l), `<p class="small"><a href="/app/demandes">← Toutes les demandes</a></p>
<div class="row"><h1 style="flex:3">${fullName(l)} ${badge(l.status)}</h1></div>
${l.client_response === 'rappel' && l.status === 'devis_envoye' ? '<div class="banner">📞 Ce client a demandé à être rappelé. Les relances sont en pause.</div>' : ''}
${l.opt_out_sms || l.opt_out_email ? `<div class="banner">Ce client s'est désinscrit (${[l.opt_out_sms && 'SMS', l.opt_out_email && 'e-mail'].filter(Boolean).join(', ')}). Aucun message automatique ne lui sera envoyé sur ce canal.</div>` : ''}
<div class="grid g2"><div>
<div class="card"><h3>Que s'est-il passé ?</h3>
<form method="post" action="/app/demandes/${l.id}/statut" class="row" style="align-items:flex-end"><input type="hidden" name="status" value="devis_envoye">
<div><label>Montant du devis ${U.C(req.account).tax} (€)</label><input name="quote_amount" inputmode="decimal" value="${l.quote_amount ?? ''}"></div><div><label>N° de devis</label><input name="quote_ref" value="${U.esc(l.quote_ref || '')}"></div>
<div style="flex:0 0 auto"><button class="btn">${l.status === 'devis_envoye' ? 'Relancer à nouveau' : "J'ai envoyé le devis"}</button></div></form>
<p class="small muted">Relances automatiques à J+${E.settingsOf(req.account).relances.days.join(', J+')} tant que le client n'a pas répondu.</p>
<div class="actions">${act('rdv', '📅 Visite prévue')}${act('accepte', '✔ Devis signé', 'ok')}${act('termine', '🏁 Chantier terminé → demander un avis')}${act('refuse', 'Refusé')}${act('perdu', 'Sans suite')}${l.status !== 'nouveau' ? act('nouveau', 'Remettre en « nouvelle »') : ''}</div></div>
<div class="card" style="margin-top:14px"><h3>Coordonnées</h3><form method="post" action="/app/demandes/${l.id}/modifier">
<div class="row">${f('first_name', 'Prénom')}${f('last_name', 'Nom')}</div><div class="row">${f('phone', 'Mobile')}${f('email', 'E-mail', 'email')}</div>
<div class="row">${f('address', 'Adresse')}${f('postal_code', 'CP')}${f('city', 'Ville')}</div>
<div class="row"><div><label>Projet</label><input name="work_type" value="${U.esc(l.work_type || '')}" list="wt"><datalist id="wt">${WORK_TYPES.map((w) => `<option>${w}</option>`).join('')}</datalist></div>${f('preferred_slot', 'Disponibilités')}</div>
<label>Demande du client</label><textarea name="message">${U.esc(l.message || '')}</textarea>
<label>Notes internes</label><textarea name="notes">${U.esc(l.notes || '')}</textarea>
<p class="row"><button class="btn sec" style="flex:0 0 auto">Enregistrer</button></p></form>
<div class="row">${l.phone ? `<a class="btn sm" style="flex:0 0 auto" href="tel:${U.esc(l.phone)}">Appeler</a>` : ''}${l.email ? `<a class="btn sm sec" style="flex:0 0 auto" href="mailto:${U.esc(l.email)}">Écrire</a>` : ''}</div>
<p class="small muted">Source : ${U.esc(SOURCES[l.source] || l.source)} · créée le ${U.frDate(l.created_at)} · consentement : ${l.consent ? 'oui' : 'non renseigné'}</p></div>
<form method="post" action="/app/demandes/${l.id}/supprimer" onsubmit="return confirm('Supprimer définitivement ce client et tout son historique ? (droit à l\\'effacement RGPD)')" style="margin-top:12px"><button class="btn sm danger">Supprimer ce client (RGPD)</button></form>
</div><div>
<div class="card"><h3>Messages automatiques</h3>${msgs.length ? `<table style="border:0">${msgs.map((m) => `<tr><td><b>${U.esc(KINDS[m.kind] || m.kind)}</b> <span class="pill">${m.channel === 'sms' ? 'SMS' : 'e-mail'}</span><div class="small muted" style="white-space:pre-wrap">${U.esc(m.body.slice(0, 220))}${m.body.length > 220 ? '…' : ''}</div>${m.error ? `<div class="small" style="color:#e03131">${U.esc(m.error)}</div>` : ''}</td>
<td class="small" style="white-space:nowrap">${mbadge(m.status)}<div>${U.frDate(m.sent_at || m.scheduled_at)}</div>${m.status === 'en_attente' ? `<form method="post" action="/app/messages/${m.id}/annuler"><button class="btn sm sec" style="margin-top:4px">Annuler</button></form>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Aucun message.</p>'}</div>
<div class="card" style="margin-top:14px"><h3>Historique</h3><ul class="timeline">${evs.map((e) => `<li><span class="small muted">${U.frDate(e.created_at)}</span> · ${U.esc(e.detail || e.type)}</li>`).join('')}</ul></div>
</div></div>`, 'demandes'));
  });
  r.post('/demandes/:id/statut', (req, res) => {
    const l = lead(req); if (!l) return res.redirect('/app/demandes');
    const status = req.body.status;
    if (!STATUSES[status]) return res.redirect(`/app/demandes/${l.id}`);
    const extra = {};
    if (status === 'devis_envoye') {
      const amount = parseFloat(String(req.body.quote_amount || '').replace(/\s/g, '').replace(',', '.'));
      if (amount > 0) extra.quote_amount = amount;
      if (req.body.quote_ref !== undefined) extra.quote_ref = req.body.quote_ref || null;
    }
    E.setStatus(db, req.account, l.id, status, extra);
    E.processDue(db).catch(() => {});
    const msg = { devis_envoye: 'Relances programmées. Elles s\'arrêtent dès que le client répond ou que vous changez le statut.', termine: "Chantier terminé : la demande d'avis Google est programmée.", accepte: 'Bravo ! Les relances sont arrêtées.' }[status] || 'Statut mis à jour.';
    back(res, `/app/demandes/${l.id}`, msg);
  });
  r.post('/demandes/:id/modifier', (req, res) => {
    const l = lead(req); if (!l) return res.redirect('/app/demandes');
    const b = req.body; const fields = {};
    for (const k of ['first_name', 'last_name', 'address', 'postal_code', 'city', 'work_type', 'preferred_slot', 'message', 'notes']) if (b[k] !== undefined) fields[k] = String(b[k]).trim();
    if (b.phone !== undefined) fields.phone = U.normalizePhone(b.phone, req.account.country);
    if (b.email !== undefined) fields.email = String(b.email).trim().toLowerCase();
    E.updateLead(db, l.id, fields);
    back(res, `/app/demandes/${l.id}`, 'Fiche enregistrée.');
  });
  r.post('/demandes/:id/supprimer', (req, res) => {
    const l = lead(req); if (!l) return res.redirect('/app/demandes');
    db.prepare('DELETE FROM leads WHERE id=?').run(l.id);
    back(res, '/app/demandes', 'Client supprimé avec tout son historique.');
  });

  // ---------- Messages ----------
  r.get('/messages', (req, res) => {
    const s = req.query.statut || 'en_attente';
    const rows = db.prepare(`SELECT m.*, l.first_name, l.last_name FROM messages m LEFT JOIN leads l ON l.id=m.lead_id WHERE m.account_id=? AND m.status=? ORDER BY ${s === 'en_attente' ? 'm.scheduled_at ASC' : 'COALESCE(m.sent_at,m.scheduled_at) DESC'} LIMIT 300`).all(req.account.id, s);
    res.send(appLayout(req, 'Messages', `<h1>Messages</h1><div class="tabs">${Object.entries(MSG_STATUS).map(([k, [l]]) => `<a class="${k === s ? 'on' : ''}" href="?statut=${k}">${l}</a>`).join('')}</div>
<p class="small muted">Les SMS et e-mails clients partent uniquement du lundi au samedi, de ${E.settingsOf(req.account).window.start}h à ${E.settingsOf(req.account).window.end}h, hors jours fériés.</p>
${rows.length ? `<table><tr><th>Type</th><th>Destinataire</th><th>Contenu</th><th>Date</th></tr>${rows.map((m) => `<tr><td>${U.esc(KINDS[m.kind] || m.kind)} <span class="pill">${m.channel === 'sms' ? 'SMS' : 'e-mail'}</span></td><td>${m.lead_id ? `<a href="/app/demandes/${m.lead_id}">${U.esc([m.first_name, m.last_name].filter(Boolean).join(' ') || m.to_addr)}</a>` : U.esc(m.to_addr)}</td><td class="small" style="max-width:420px">${m.subject ? `<b>${U.esc(m.subject)}</b><br>` : ''}${U.esc(m.body.slice(0, 160))}${m.error ? `<div style="color:#e03131">${U.esc(m.error)}</div>` : ''}</td><td class="small">${mbadge(m.status)}<div>${U.frDate(m.sent_at || m.scheduled_at)}</div>${m.status === 'en_attente' ? `<form method="post" action="/app/messages/${m.id}/annuler"><button class="btn sm sec">Annuler</button></form>` : ''}</td></tr>`).join('')}</table>` : '<div class="card muted">Aucun message.</div>'}`, 'messages'));
  });
  r.post('/messages/:mid/annuler', (req, res) => {
    const m = db.prepare('SELECT * FROM messages WHERE id=? AND account_id=?').get(req.params.mid, req.account.id);
    if (m && m.status === 'en_attente') db.prepare(`UPDATE messages SET status='annule', error='annulé manuellement' WHERE id=?`).run(m.id);
    back(res, m && m.lead_id ? `/app/demandes/${m.lead_id}` : '/app/messages', 'Message annulé.');
  });

  // ---------- Bilan mensuel ----------
  r.get('/rapport', (req, res) => {
    const ym = /^\d{4}-\d{2}$/.test(req.query.mois || '') ? req.query.mois : E.currentMonth();
    const [f, t] = E.monthRange(ym);
    const st = E.stats(db, req.account.id, f, t);
    const signed = db.prepare(`SELECT * FROM leads WHERE account_id=? AND status IN ('accepte','termine') AND decided_at>=? AND decided_at<? ORDER BY decided_at`).all(req.account.id, U.iso(f), U.iso(t));
    const months = []; let m = E.currentMonth(); for (let i = 0; i < 12; i++) { months.push(m); m = E.prevMonth(m); }
    const line = (l, v) => `<tr><td>${l}</td><td class="right"><b>${v}</b></td></tr>`;
    res.send(appLayout(req, 'Bilan', `<div class="row"><h1 style="flex:3">Bilan de ${E.monthLabel(ym)}</h1><form class="noprint row" style="flex:2"><select name="mois" onchange="this.form.submit()">${months.map((x) => `<option value="${x}" ${x === ym ? 'selected' : ''}>${E.monthLabel(x)}</option>`).join('')}</select><button type="button" class="btn sec" onclick="print()" style="flex:0 0 auto">Imprimer / PDF</button></form></div>
<p class="muted">${U.esc(req.account.company_name)}</p>
<div class="grid g4"><div class="card kpi"><div class="v">${st.signes}</div><div class="l">devis signés</div></div><div class="card kpi"><div class="v">${U.euros(st.ca)}</div><div class="l">chiffre d'affaires signé</div></div>
<div class="card kpi"><div class="v">${U.euros(st.caApresRelance)}</div><div class="l">signé après relance automatique</div></div><div class="card kpi"><div class="v">${st.taux} %</div><div class="l">taux de signature</div></div></div>
<h2>Détail</h2><table style="max-width:640px">${line('Nouvelles demandes reçues', st.demandes)}${line('Appels manqués traités par SMS', st.appels)}${line('Devis envoyés', st.devis)}${line('Devis relancés automatiquement', st.devisRelances)}${line('Messages de relance envoyés', st.relances)}${line('Devis signés', st.signes)}${line('… dont signés après une relance', st.signesApresRelance)}${line("Demandes d'avis Google envoyées", st.avisDemandes)}${line('Clients ayant ouvert le lien Google', st.avisClics)}</table>
${signed.length ? `<h2>Chantiers signés</h2><table><tr><th>Client</th><th>Projet</th><th>Montant</th><th>Date</th></tr>${signed.map((l) => `<tr><td>${fullName(l)}</td><td>${U.esc(l.work_type || '')}</td><td>${U.euros(l.quote_amount)}</td><td>${U.frDate(l.decided_at, false)}</td></tr>`).join('')}</table>` : ''}
<p class="small muted noprint">Ce bilan est envoyé automatiquement par e-mail le 1er de chaque mois.</p>`, 'rapport'));
  });

  // ---------- Intégration : formulaire, site, appels manqués ----------
  r.get('/integration', (req, res) => {
    const a = req.account, B = E.BASE();
    res.send(appLayout(req, 'Intégration', `<h1>Formulaire, site & appels manqués</h1>
<div class="grid g2">
<div class="card"><h3>1. Formulaire de devis</h3><p>Lien direct (à mettre sur Facebook, Google Business, cartes de visite…) :</p><pre class="code">${B}/f/${a.slug}</pre><a class="btn sm sec" target="_blank" href="/f/${a.slug}">Voir le formulaire</a>
<p>Pour l'intégrer à un site existant (WordPress, Wix…), copiez ce code :</p><pre class="code">${U.esc(`<iframe src="${B}/f/${a.slug}?embed=1" style="width:100%;min-height:980px;border:0" title="Demande de devis"></iframe>`)}</pre></div>
<div class="card"><h3>2. Mini-site vitrine</h3><p>Site prêt à l'emploi avec le formulaire intégré :</p><pre class="code">${B}/s/${a.slug}</pre><a class="btn sm sec" target="_blank" href="/s/${a.slug}">Voir le site</a>
<p class="small muted">Textes, prestations, couleur et zone d'intervention se modifient dans Réglages. Pour un nom de domaine à lui (ex. dupont-chauffage.fr), faites une redirection vers ce lien.</p></div>
<div class="card"><h3>3. SMS automatique après un appel manqué</h3>
<p><b>Option A (Twilio, la plus simple côté artisan) :</b> achetez un numéro Twilio, réglez son « A call comes in » sur ce webhook (POST), puis l'artisan active le renvoi d'appel « si non-réponse » vers ce numéro (code **61*numéro# sur son mobile).</p><pre class="code">${B}/webhooks/twilio/voix/${a.webhook_token}</pre>
<p><b>Option B (standard téléphonique, Make, Zapier, appli d'appels) :</b> appelez cette adresse avec le numéro de l'appelant :</p><pre class="code">${B}/webhooks/appel-manque/${a.webhook_token}?from=${U.C(a).mobileExample.replace(/ /g, '')}</pre>
<p>Page de prise de RDV envoyée par SMS : <a href="/rdv/${a.slug}" target="_blank">${B}/rdv/${a.slug}</a>${a.booking_url ? ' (redirige vers votre agenda en ligne)' : ''}</p>
<form method="post" action="/app/integration/test-appel" class="row"><input name="from" placeholder="Numéro mobile de test, ex. ${U.C(a).mobileExample}"><div style="flex:0 0 auto"><button class="btn sm">Simuler un appel manqué</button></div></form></div>
<div class="card"><h3>4. Réponse STOP aux SMS</h3><p>Dans Brevo (ou Twilio), configurez l'URL des SMS entrants sur :</p><pre class="code">${B}/webhooks/sms-entrant${process.env.INBOUND_KEY ? '?key=' + U.esc(process.env.INBOUND_KEY) : ''}</pre><p class="small muted">Un client qui répond STOP ne reçoit plus aucun SMS, chez aucun de vos artisans.</p></div>
</div>`, 'integration'));
  });
  r.post('/integration/test-appel', async (req, res) => {
    const out = E.missedCall(db, req.account, req.body.from);
    await E.processDue(db).catch(() => {});
    if (!out.ok) return res.redirect('/app/integration?err=' + encodeURIComponent(`Test impossible : ${out.reason}`));
    back(res, out.leadId ? `/app/demandes/${out.leadId}` : '/app/integration', out.skipped ? `SMS non renvoyé : ${out.skipped}.` : 'Appel manqué simulé : voici la fiche créée et le SMS envoyé.');
  });

  // ---------- Appli installable & notifications ----------
  const push = require('../push');
  r.get('/appli', (req, res) => {
    const n = push.count(db, req.account.id);
    res.send(appLayout(req, 'Appli & notifications', `<h1>Appli & notifications</h1>
<div class="grid g2"><div class="card" id="pwa"><h3>🔔 Être prévenu tout de suite</h3>
<p>Recevez une notification sur ce téléphone à chaque nouvelle demande, appel manqué, devis accepté ou client à rappeler.</p>
<p id="pwa-status" class="small muted">Vérification…</p>
<p class="row"><button class="btn" id="pwa-on" style="flex:0 0 auto">Activer les notifications</button><button class="btn sec" id="pwa-test" style="display:none;flex:0 0 auto">Envoyer un test</button><button class="btn sm grey" id="pwa-off" style="display:none;flex:0 0 auto">Désactiver sur cet appareil</button></p>
<p class="small muted">${n ? `${n} appareil(s) reçoivent déjà vos notifications.` : 'Aucun appareil ne reçoit encore vos notifications.'} À faire sur chaque téléphone ou ordinateur où vous voulez être prévenu.</p></div>
<div class="card"><h3>📲 Installer ChauffPro sur l'écran d'accueil</h3>
<p><button class="btn" id="pwa-install" style="display:none">Installer l'appli</button></p>
<p><b>Android (Chrome) :</b> menu ⋮ en haut à droite, puis « Installer l'application » (ou « Ajouter à l'écran d'accueil »).</p>
<p><b>iPhone (Safari) :</b> bouton Partager <span aria-hidden="true">⬆️</span> en bas, puis « Sur l'écran d'accueil ». Ouvrez ensuite ChauffPro depuis l'icône et activez les notifications ici.</p>
<p id="pwa-ios" class="banner" style="display:none">Sur iPhone, les notifications ne marchent qu'une fois l'appli installée sur l'écran d'accueil (iOS 16.4 ou plus récent).</p>
<p class="small muted">L'appli s'ouvre directement sur votre tableau de bord, en plein écran, comme une vraie application.</p></div></div>`, 'appli'));
  });
  r.get('/push/cle', (req, res) => res.type('text/plain').send(push.publicKey(db)));
  r.post('/push/abonner', (req, res) => res.json({ ok: push.subscribe(db, req.account.id, req.body) }));
  r.post('/push/desabonner', (req, res) => { push.unsubscribe(db, req.account.id, req.body && req.body.endpoint); res.json({ ok: true }); });
  r.post('/push/test', async (req, res) => res.json({ ok: true, sent: await push.notify(db, req.account, { title: '🔔 ChauffPro', body: 'Les notifications fonctionnent ! Vous serez prévenu à chaque nouvelle demande.', url: '/app' }) }));

  // ---------- Réglages ----------
  r.get('/reglages', (req, res) => {
    const a = req.account, s = E.settingsOf(a);
    const v = (k) => U.esc(a[k] || '');
    const chk = (name, on, label) => `<label class="chk"><input type="checkbox" name="${name}" value="1" ${on ? 'checked' : ''}> ${label}</label>`;
    const T = DEFAULT_SETTINGS.templates;
    const tpl = (k, label) => `<label>${label}</label>${k.endsWith('_subject') ? `<input name="tpl_${k}" value="${U.esc(s.templates[k])}">` : `<textarea name="tpl_${k}" rows="${k.endsWith('_sms') ? 3 : 6}">${U.esc(s.templates[k])}</textarea>`}`;
    res.send(appLayout(req, 'Réglages', `<h1>Réglages</h1><form method="post" action="/app/reglages">
<div class="grid g2"><div class="card"><h3>Entreprise</h3>
<div class="row"><div><label>Nom de l'entreprise</label><input name="company_name" value="${v('company_name')}" required></div><div><label>Votre nom (signature)</label><input name="owner_name" value="${v('owner_name')}"></div></div>
<div class="row"><div><label>Téléphone (mobile pour les alertes SMS)</label><input name="phone" value="${U.esc(U.displayPhone(a.phone))}"></div><div><label>E-mail (reçoit les alertes)</label><input name="email" type="email" value="${v('email')}" required></div></div>
<div class="row"><div><label>Nom d'expéditeur SMS (11 caractères, sans espace)</label><input name="sms_sender" maxlength="11" value="${v('sms_sender')}"></div><div><label>Couleur</label><input name="primary_color" type="color" value="${v('primary_color') || '#d9480f'}"></div></div>
<label>Lien pour laisser un avis Google</label><input name="google_review_url" value="${v('google_review_url')}" placeholder="https://g.page/r/…/review">
<p class="small muted">Dans Google Business Profile : « Demander des avis » → copiez le lien.</p>
<label>Agenda en ligne (facultatif : Calendly, Google Agenda…)</label><input name="booking_url" value="${v('booking_url')}" placeholder="Laisser vide pour utiliser la page de RDV intégrée">
</div><div class="card"><h3>Mini-site</h3>
<div class="row"><div><label>Ville principale</label><input name="city" value="${v('city')}"></div><div><label>${U.C(a).bizLabel}</label><input name="siret" value="${v('siret')}"></div></div>
<label>Pays</label><select name="country">${Object.entries(U.COUNTRIES).map(([k, c]) => `<option value="${k}" ${U.countryOf(a) === k ? 'selected' : ''}>${c.name}</option>`).join('')}</select>
<label>Adresse</label><input name="address" value="${v('address')}"><label>Zone d'intervention</label><input name="zone" value="${v('zone')}" placeholder="Bruxelles et les 19 communes">
<label>Présentation</label><textarea name="about">${v('about')}</textarea><label>Prestations (une par ligne)</label><textarea name="services">${v('services')}</textarea></div></div>
<div class="grid g2" style="margin-top:14px"><div class="card"><h3>Automatisations</h3>
${chk('rel_enabled', s.relances.enabled, '<b>Relances de devis</b>')}
<div class="row"><div><label>Relance 1 (jours)</label><input name="rel_d1" type="number" min="1" value="${s.relances.days[0] ?? 2}"></div><div><label>Relance 2</label><input name="rel_d2" type="number" min="1" value="${s.relances.days[1] ?? 7}"></div><div><label>Relance 3</label><input name="rel_d3" type="number" min="1" value="${s.relances.days[2] ?? 14}"></div></div>
<div class="row">${chk('rel_sms', s.relances.sms, 'par SMS')}${chk('rel_email', s.relances.email, 'par e-mail')}</div><hr>
${chk('avis_enabled', s.avis.enabled, "<b>Demandes d'avis Google</b> après « Chantier terminé »")}
<div class="row"><div><label>Envoyer après (heures)</label><input name="avis_delay" type="number" min="0" value="${s.avis.delay_hours}"></div><div><label>Rappel après (jours, 0 = aucun)</label><input name="avis_rem" type="number" min="0" value="${s.avis.reminder_days}"></div></div>
<div class="row">${chk('avis_sms', s.avis.sms, 'par SMS')}${chk('avis_email', s.avis.email, 'par e-mail')}</div><hr>
${chk('ent_enabled', s.entretien.enabled, "<b>Rappel d'entretien</b> après « Chantier terminé », puis chaque année")}
<div class="row"><div><label>Envoyer après (mois)</label><input name="ent_months" type="number" min="1" max="36" value="${s.entretien.months}"></div><div></div></div>
<div class="row">${chk('ent_sms', s.entretien.sms, 'par SMS')}${chk('ent_email', s.entretien.email, 'par e-mail')}</div><hr>
${chk('appel_enabled', s.appel.enabled, '<b>SMS automatique après un appel manqué</b>')}
${chk('conf_enabled', s.confirmation.enabled, '<b>Accusé de réception</b> au client après une demande')}<hr>
<h3>Alertes pour vous</h3><div class="row">${chk('notif_email', s.notif.email, 'par e-mail')}${chk('notif_sms', s.notif.sms, 'par SMS')}</div>${chk('rapport', s.rapport.enabled, 'Bilan mensuel par e-mail')}
<div class="row"><div><label>Envois clients à partir de (h)</label><input name="win_start" type="number" min="8" max="20" value="${s.window.start}"></div><div><label>jusqu'à (h)</label><input name="win_end" type="number" min="9" max="20" value="${s.window.end}"></div></div>
<label>Mention ajoutée aux SMS de relance et d'avis (laisser vide avec Brevo, qui ajoute « STOP au 3xxxx » automatiquement)</label><input name="sms_footer" value="${U.esc(s.sms_footer)}"></div>
<div class="card"><h3>Textes des messages</h3><p class="small muted">Variables : {prenom} {nom} {entreprise} {artisan} {tel} {travaux} {ref} {montant} {lien} (réponse au devis) {lien_avis} {lien_rdv}</p>
${Object.keys(T).filter((k) => k !== 'appel_vocal').map((k) => tpl(k, k.replace(/_/g, ' '))).join('')}${tpl('appel_vocal', 'message vocal (Twilio)')}</div></div>
<p><button class="btn">Enregistrer les réglages</button></p></form>
<div class="card" style="max-width:480px;margin-top:14px"><h3>Mot de passe</h3><form method="post" action="/app/mot-de-passe"><label>Nouveau mot de passe</label><input type="password" name="password" minlength="8" required><p><button class="btn sec">Changer</button></p></form></div>`, 'reglages'));
  });
  r.post('/reglages', (req, res) => {
    const a = req.account, b = req.body, s = E.settingsOf(a);
    const n = (x, d) => (Number.isFinite(+x) && x !== '' ? +x : d);
    s.relances = { enabled: !!b.rel_enabled, days: [n(b.rel_d1, 2), n(b.rel_d2, 7), n(b.rel_d3, 14)].filter((d) => d > 0), sms: !!b.rel_sms, email: !!b.rel_email };
    s.avis = { enabled: !!b.avis_enabled, delay_hours: n(b.avis_delay, 3), reminder_days: n(b.avis_rem, 4), sms: !!b.avis_sms, email: !!b.avis_email };
    s.appel = { enabled: !!b.appel_enabled };
    s.entretien = { enabled: !!b.ent_enabled, months: Math.min(36, Math.max(1, n(b.ent_months, 12))), sms: !!b.ent_sms, email: !!b.ent_email };
    s.confirmation = { ...s.confirmation, enabled: !!b.conf_enabled };
    s.notif = { email: !!b.notif_email, sms: !!b.notif_sms };
    s.rapport = { enabled: !!b.rapport };
    s.window = { start: Math.min(20, Math.max(8, n(b.win_start, 9))), end: Math.min(20, Math.max(9, n(b.win_end, 19))) };
    s.sms_footer = String(b.sms_footer ?? s.sms_footer);
    for (const k of Object.keys(DEFAULT_SETTINGS.templates)) if (b[`tpl_${k}`] !== undefined) s.templates[k] = String(b[`tpl_${k}`]);
    const email = String(b.email || a.email).trim().toLowerCase();
    const country = U.COUNTRIES[b.country] ? b.country : U.countryOf(a);
    if (db.prepare('SELECT 1 FROM accounts WHERE email=? AND id<>?').get(email, a.id)) return res.redirect('/app/reglages?err=' + encodeURIComponent('Cet e-mail est déjà utilisé par un autre compte.'));
    db.prepare(`UPDATE accounts SET company_name=?, owner_name=?, phone=?, email=?, sms_sender=?, primary_color=?, google_review_url=?, booking_url=?, city=?, siret=?, address=?, zone=?, about=?, services=?, settings=?, country=? WHERE id=?`)
      .run(b.company_name || a.company_name, b.owner_name || '', U.normalizePhone(b.phone, country), email, (b.sms_sender || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 11), /^#[0-9a-f]{6}$/i.test(b.primary_color) ? b.primary_color : a.primary_color,
        (b.google_review_url || '').trim(), (b.booking_url || '').trim(), b.city || '', b.siret || '', b.address || '', b.zone || '', b.about || '', b.services || '', JSON.stringify(s), country, a.id);
    back(res, '/app/reglages', 'Réglages enregistrés.');
  });
  r.post('/mot-de-passe', (req, res) => {
    if (req.account.is_demo) return res.redirect('/app/reglages?err=' + encodeURIComponent('Pas de mot de passe sur un compte de démonstration.'));
    if (String(req.body.password || '').length < 8) return res.redirect('/app/reglages?err=' + encodeURIComponent('8 caractères minimum.'));
    db.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(U.hashPassword(req.body.password), req.account.id);
    back(res, '/app/reglages', 'Mot de passe modifié.');
  });

  // ---------- Export CSV (portabilité RGPD) ----------
  r.get('/export.csv', (req, res) => {
    const rows = db.prepare('SELECT * FROM leads WHERE account_id=? ORDER BY created_at').all(req.account.id);
    const cols = ['created_at', 'first_name', 'last_name', 'phone', 'email', 'address', 'postal_code', 'city', 'work_type', 'source', 'status', 'quote_ref', 'quote_amount', 'quote_sent_at', 'decided_at', 'completed_at', 'review_clicked_at', 'message', 'notes'];
    const cell = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clients.csv"');
    res.send('﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\n'));
  });

  return r;
};
