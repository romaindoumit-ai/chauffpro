// Point d'entrée : `npm start`
process.removeAllListeners('warning');
const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const A = require('./auth');
const E = require('./engine');
const U = require('./util');
const { publicLayout, APP_NAME } = require('./views');

function createApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '200kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
  app.use(A.loadSession(db));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.redirect(req.account ? (req.account.is_admin ? '/admin' : '/app') : '/connexion'));

  const loginPage = (err = '') => publicLayout(`Connexion · ${APP_NAME()}`, `<div class="card" style="max-width:420px;margin:40px auto"><h1>${U.esc(APP_NAME())}</h1><p class="muted">Espace artisan</p>
${err ? `<div class="flash err">${U.esc(err)}</div>` : ''}<form method="post" action="/connexion"><label>E-mail</label><input name="email" type="email" required autofocus><label>Mot de passe</label><input name="password" type="password" required><p><button class="btn" style="width:100%">Se connecter</button></p></form></div>`);
  app.get('/connexion', (req, res) => res.send(loginPage()));
  const attempts = new Map();
  app.post('/connexion', (req, res) => {
    const key = req.ip; const t = Date.now();
    const arr = (attempts.get(key) || []).filter((x) => t - x < 900000);
    if (arr.length >= 10) return res.status(429).send(loginPage('Trop de tentatives, réessayez dans 15 minutes.'));
    const a = db.prepare('SELECT * FROM accounts WHERE email=?').get(String(req.body.email || '').trim().toLowerCase());
    if (!a || !U.checkPassword(req.body.password, a.password_hash)) { arr.push(t); attempts.set(key, arr); return res.status(401).send(loginPage('E-mail ou mot de passe incorrect.')); }
    if (!a.active) return res.status(403).send(loginPage('Compte suspendu. Contactez votre prestataire.'));
    A.createSession(db, res, a.id);
    res.redirect(a.is_admin ? '/admin' : '/app');
  });
  app.post('/deconnexion', (req, res) => { A.destroySession(db, req, res); res.redirect('/connexion'); });

  app.use('/app', A.requireLogin, A.sameOrigin, require('./routes/app')(db));
  app.use('/admin', A.requireLogin, A.sameOrigin, A.requireAdmin(db), require('./routes/admin')(db));
  app.use('/', require('./routes/public')(db));
  app.use((req, res) => res.status(404).send(publicLayout('Page introuvable', '<div class="card"><h1>Page introuvable</h1><p><a href="/">Retour</a></p></div>')));
  app.use((err, req, res, next) => { console.error(err); res.status(500).send(publicLayout('Erreur', '<div class="card"><h1>Oups, une erreur est survenue</h1><p>Réessayez dans un instant.</p></div>')); });
  return app;
}

if (require.main === module) {
  const db = openDb();
  A.ensureAdmin(db);
  const port = process.env.PORT || 3000;
  createApp(db).listen(port, () => {
    const m = require('./providers').providerMode();
    console.log(`${APP_NAME()} démarré sur ${E.BASE()} (port ${port}) · SMS : ${m.sms} · e-mail : ${m.email}`);
  });
  E.startScheduler(db);
}

module.exports = { createApp };
