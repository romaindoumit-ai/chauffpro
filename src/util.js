const crypto = require('node:crypto');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const token = (n = 18) => crypto.randomBytes(n).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pw), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

// Numéro français -> format international +33XXXXXXXXX
function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^0[1-9]\d{8}$/.test(p)) p = '+33' + p.slice(1);
  if (/^33[1-9]\d{8}$/.test(p)) p = '+' + p;
  return /^\+\d{8,15}$/.test(p) ? p : '';
}
function displayPhone(p) {
  if (!p) return '';
  if (/^\+33\d{9}$/.test(p)) return ('0' + p.slice(3)).replace(/(\d{2})(?=\d)/g, '$1 ');
  return p;
}
const isMobile = (p) => /^\+33[67]\d{8}$/.test(p) || (p.startsWith('+') && !p.startsWith('+33'));

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'artisan';
}

function render(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

// ---------- Heures d'envoi autorisées (Europe/Paris) ----------
const fmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});
function parisParts(d) {
  const o = {};
  for (const p of fmt.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, wd: o.weekday.replace('.', '') };
}
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
function frenchHolidays(y) {
  const e = easter(y), add = (n) => { const x = new Date(e); x.setUTCDate(x.getUTCDate() + n); return `${x.getUTCMonth() + 1}-${x.getUTCDate()}`; };
  return new Set(['1-1', '5-1', '5-8', '7-14', '8-15', '11-1', '11-11', '12-25', add(1), add(39), add(50)]);
}
function isHoliday(p) { return frenchHolidays(p.y).has(`${p.m}-${p.d}`); }

// Fenêtre par défaut : lundi-samedi, 9h-19h, hors dimanches et jours fériés.
function inWindow(date, win) {
  win = win || { start: 9, end: 19 };
  const p = parisParts(date);
  if (!win.allDays && (p.wd.startsWith('dim') || isHoliday(p))) return false;
  return p.h >= win.start && p.h < win.end;
}
function nextAllowed(date, win) {
  let d = new Date(date);
  for (let i = 0; i < 24 * 4 * 12 && !inWindow(d, win); i++) {
    d = new Date(Math.floor(d.getTime() / 900000) * 900000 + 900000); // pas de 15 min
  }
  return d;
}

const iso = (d) => new Date(d).toISOString();
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
const addHours = (d, n) => new Date(new Date(d).getTime() + n * 3600000);

function frDate(s, withTime = true) {
  if (!s) return '';
  const d = new Date(s.endsWith('Z') || s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}
const euros = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));

module.exports = { esc, token, hashPassword, checkPassword, normalizePhone, displayPhone, isMobile, slugify, render, parisParts, inWindow, nextAllowed, frenchHolidays, iso, addDays, addHours, frDate, euros };
