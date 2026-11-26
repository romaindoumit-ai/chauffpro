// Notifications sur le téléphone de l'artisan (Web Push), sans compte ni clé à créer :
// les clés « VAPID » sont générées au premier démarrage et gardées dans la base de données.
const webpush = require('web-push');
const U = require('./util');

function config(db, key, make) {
  const row = db.prepare('SELECT value FROM app_config WHERE key=?').get(key);
  if (row) return row.value;
  const value = make();
  db.prepare('INSERT OR IGNORE INTO app_config (key, value) VALUES (?,?)').run(key, value);
  return db.prepare('SELECT value FROM app_config WHERE key=?').get(key).value;
}

function vapid(db) {
  const keys = JSON.parse(config(db, 'vapid', () => JSON.stringify(webpush.generateVAPIDKeys())));
  return keys;
}
const publicKey = (db) => vapid(db).publicKey;

function subscribe(db, accountId, sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
  db.prepare('DELETE FROM push_subs WHERE endpoint=?').run(sub.endpoint);
  db.prepare('INSERT INTO push_subs (account_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)').run(accountId, sub.endpoint, String(sub.keys.p256dh), String(sub.keys.auth), U.iso(new Date()));
  return true;
}
function unsubscribe(db, accountId, endpoint) {
  db.prepare('DELETE FROM push_subs WHERE account_id=? AND endpoint=?').run(accountId, String(endpoint || ''));
}
const count = (db, accountId) => db.prepare('SELECT COUNT(*) n FROM push_subs WHERE account_id=?').get(accountId).n;

/** Envoie une notification à tous les téléphones de l'artisan. Ne lève jamais d'erreur. */
async function notify(db, account, { title, body, url = '/app' }) {
  const subs = db.prepare('SELECT * FROM push_subs WHERE account_id=?').all(account.id);
  if (!subs.length) return 0;
  const k = vapid(db);
  const subject = (process.env.BASE_URL || '').startsWith('https') ? process.env.BASE_URL : 'mailto:notifications@chauffpro.invalid';
  const payload = JSON.stringify({ title: String(title).slice(0, 120), body: String(body || '').slice(0, 300), url });
  let n = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 86400 });
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id=?').run(s.id); // téléphone désinscrit
      else console.error('[push]', e.statusCode || '', e.message);
    }
  }));
  return n;
}

module.exports = { publicKey, subscribe, unsubscribe, notify, count };
