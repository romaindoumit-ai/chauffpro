const U = require('./util');
const providers = require('./providers');

const COOKIE = 'sid';
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const secure = () => (process.env.BASE_URL || '').startsWith('https');

function createSession(db, res, accountId, adminId = null) {
  const id = U.token(32);
  db.prepare('INSERT INTO sessions (id, account_id, admin_id, expires_at) VALUES (?,?,?,?)').run(id, accountId, adminId, U.iso(U.addDays(new Date(), 30)));
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure() ? '; Secure' : ''}`);
  return id;
}
function destroySession(db, req, res) {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) db.prepare('DELETE FROM sessions WHERE id=?').run(sid);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
const loadSession = (db) => (req, res, next) => {
  const sid = parseCookies(req.headers.cookie)[COOKIE];
  if (sid) {
    const s = db.prepare('SELECT * FROM sessions WHERE id=? AND expires_at>?').get(sid, U.iso(new Date()));
    if (s) {
      const a = db.prepare('SELECT * FROM accounts WHERE id=?').get(s.account_id);
      if (a && (a.active || s.admin_id)) { req.account = a; req.sessionId = sid; req.adminId = s.admin_id; }
    }
  }
  const m = providers.providerMode();
  req.simulation = m.sms === 'simulation' || m.email === 'simulation';
  next();
};
const requireLogin = (req, res, next) => (req.account ? next() : res.redirect('/connexion'));
const requireAdmin = (db) => (req, res, next) => {
  if (req.account && req.account.is_admin) return next();
  if (req.adminId) { const ad = db.prepare('SELECT * FROM accounts WHERE id=? AND is_admin=1').get(req.adminId); if (ad) { req.realAdmin = ad; return next(); } }
  res.status(403).send('Accès réservé à l\'administrateur');
};

// Protection CSRF : les formulaires de l'espace connecté doivent venir du même site.
const sameOrigin = (req, res, next) => {
  if (req.method !== 'POST') return next();
  const o = req.headers.origin || req.headers.referer || '';
  if (!o) return next();
  try { if (new URL(o).host === req.headers.host) return next(); } catch {}
  res.status(403).send('Requête refusée');
};

function ensureAdmin(db) {
  const email = (process.env.ADMIN_EMAIL || 'admin@exemple.fr').toLowerCase();
  const exists = db.prepare('SELECT id FROM accounts WHERE is_admin=1').get();
  if (exists) return;
  const pw = process.env.ADMIN_PASSWORD || U.token(9);
  db.prepare(`INSERT INTO accounts (slug, company_name, owner_name, email, password_hash, webhook_token, is_admin, monthly_price) VALUES ('admin', ?, 'Administrateur', ?, ?, ?, 1, 0)`)
    .run(process.env.APP_NAME || 'ChauffPro', email, U.hashPassword(pw), U.token());
  if (!process.env.ADMIN_PASSWORD) console.log(`\n>>> Compte administrateur créé : ${email} / mot de passe : ${pw}\n`);
}

module.exports = { createSession, destroySession, loadSession, requireLogin, requireAdmin, sameOrigin, ensureAdmin };
