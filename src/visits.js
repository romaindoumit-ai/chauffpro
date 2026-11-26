// Créneaux de visite : le client choisit lui-même un créneau libre dans le formulaire.
const U = require('./util');
const I = require('./i18n');
const { mergeSettings } = require('./defaults');

const DAY_NAMES = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const DAY_LABELS = { lun: 'Lundi', mar: 'Mardi', mer: 'Mercredi', jeu: 'Jeudi', ven: 'Vendredi', sam: 'Samedi', dim: 'Dimanche' };

/** Heure locale (Bruxelles/Paris) -> Date UTC. */
function localToUtc(y, m, d, h) {
  let t = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 2; i++) { const p = U.parisParts(new Date(t)); const diff = ((p.h - h + 36) % 24) - 12; t -= diff * 3600000; }
  return new Date(t);
}

/** « 8-10, 10-12, 13h30-15 » -> [[8,10],[10,12],[13.5,15]] (les créneaux invalides sont ignorés). */
function parseSlots(txt) {
  return String(txt || '').split(/[,;\n]+/).map((x) => x.trim().toLowerCase().replace(/h/g, ':').replace(/:(?=\D|$)/g, ''))
    .map((x) => x.match(/^(\d{1,2})(?::(\d{2}))?\s*[-àa]\s*(\d{1,2})(?::(\d{2}))?$/))
    .filter(Boolean).map((m) => [+m[1] + (+m[2] || 0) / 60, +m[3] + (+m[4] || 0) / 60])
    .filter(([a, b]) => a >= 6 && b <= 22 && b > a).sort((a, b) => a[0] - b[0]);
}
const hh = (x, lang) => `${Math.floor(x)}${lang === 'nl' ? 'u' : 'h'}${x % 1 ? String(Math.round((x % 1) * 60)).padStart(2, '0') : ''}`;
const slotsText = (slots) => slots.map(([a, b]) => `${hh(a)}-${hh(b)}`).join(', ');

function config(account) {
  const v = mergeSettings(account.settings).visites;
  return { ...v, slotList: parseSlots(v.slots) };
}

/** Libellé d'un créneau : « mardi 2 décembre, 10h-12h ». */
function label(iso, account, lang = 'fr') {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString(I.locale(lang), { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' });
  const p = U.parisParts(d), start = p.h + p.min / 60;
  const slot = account ? config(account).slotList.find(([a]) => Math.abs(a - start) < 0.01) : null;
  return `${day}, ${slot ? `${hh(slot[0], lang)}-${hh(slot[1], lang)}` : hh(start, lang)}`;
}

/** Créneaux libres des prochains jours, regroupés par jour. */
function available(db, account, { from = new Date(), keep, lang = 'fr' } = {}) {
  const c = config(account);
  if (!c.enabled || !c.slotList.length) return [];
  const country = U.countryOf(account);
  const taken = new Map();
  for (const r of db.prepare(`SELECT visit_at, COUNT(*) n FROM leads WHERE account_id=? AND visit_at>=? AND status NOT IN ('refuse','perdu') GROUP BY visit_at`).all(account.id, U.iso(from))) taken.set(r.visit_at, r.n);
  const minStart = U.addHours(from, Number(c.min_hours) || 0);
  const days = [];
  for (let i = 0; i <= (Number(c.horizon_days) || 14); i++) {
    const p = U.parisParts(U.addDays(from, i));
    const wd = p.wd.slice(0, 3);
    if (!c.days.includes(wd)) continue;
    const ymd = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    if (U.holidays(p.y, country).has(`${p.m}-${p.d}`)) continue;
    if (c.closed_from && c.closed_to && ymd >= c.closed_from && ymd <= c.closed_to) continue;
    const slots = c.slotList.map(([a, b]) => {
      const iso = U.iso(localToUtc(p.y, p.m, p.d, Math.floor(a)).getTime() + Math.round((a % 1) * 60) * 60000);
      return { iso, text: `${hh(a, lang)}-${hh(b, lang)}`, free: iso === keep || ((taken.get(iso) || 0) < (Number(c.per_slot) || 1) && new Date(iso) >= minStart) };
    }).filter((s) => s.free);
    if (slots.length) days.push({ ymd, label: new Date(slots[0].iso).toLocaleDateString(I.locale(lang), { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long' }), slots });
  }
  return days;
}
const isAvailable = (db, account, iso, opts) => available(db, account, opts).some((d) => d.slots.some((s) => s.iso === iso));

/** Le sélecteur de créneaux affiché dans les formulaires (boutons radio, sans JavaScript). */
function picker(db, account, { selected = '', required = false, lang = 'fr' } = {}) {
  const t = I.t(lang);
  const days = available(db, account, { lang });
  if (!days.length) return '';
  const max = 3; // jours affichés d'emblée, le reste derrière « Plus de dates »
  const day = (d) => `<div class="vday"><div class="vday-l">${U.esc(d.label)}</div><div class="vslots">${d.slots.map((s) => `<label class="vslot"><input type="radio" name="visit" value="${s.iso}" ${s.iso === selected ? 'checked' : ''} ${required ? 'required' : ''}><span>${s.text}</span></label>`).join('')}</div></div>`;
  return `<fieldset class="visit"><legend>📅 ${t('visit_legend')}${required ? ' *' : ` (${t('optional')})`}</legend>
<p class="small muted">${t('visit_help')}</p>
${days.slice(0, max).map(day).join('')}${days.length > max ? `<details><summary class="small">${t('more_dates')}</summary>${days.slice(max).map(day).join('')}</details>` : ''}
${required ? '' : `<label class="vslot none"><input type="radio" name="visit" value="" ${selected ? '' : 'checked'}><span>${t('no_pref')}</span></label>`}</fieldset>`;
}

module.exports = { DAY_NAMES, DAY_LABELS, localToUtc, parseSlots, slotsText, config, label, available, isAvailable, picker };
