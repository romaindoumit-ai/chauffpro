const { esc, displayPhone } = require('./util');
const { STATUSES } = require('./defaults');

// app = page de l'espace artisan : l'appli peut être installée sur le téléphone.
const PWA = `<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#d9480f"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="ChauffPro">`;
const head = (title, color, { app, lang = 'fr' } = {}) => `<!doctype html><html lang="${lang === 'nl' ? 'nl' : 'fr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/style.css">${app ? PWA : ''}${color ? `<style>:root{--c:${esc(color)}}</style>` : ''}</head>`;

const APP_NAME = () => process.env.APP_NAME || 'ChauffPro';

function appLayout(req, title, body, active = '') {
  const a = req.account;
  const nav = [['/app', 'Tableau de bord', 'home'], ['/app/demandes', 'Demandes & devis', 'demandes'], ['/app/messages', 'Messages programmés', 'messages'],
    ['/app/rapport', 'Bilan mensuel', 'rapport'], ['/app/integration', 'Formulaire, site & appels', 'integration'], ...(require('./ai').enabled() ? [['/app/avis-google', '✨ Répondre aux avis', 'avis']] : []), ['/app/appli', 'Appli & notifications', 'appli'], ...(a.stripe_customer_id ? [['/app/abonnement', 'Abonnement', 'abonnement']] : []), ['/app/reglages', 'Réglages', 'reglages']];
  if (a.is_admin || req.adminId) nav.push(['/admin', 'Administration', 'admin']);
  const imp = req.adminId && req.adminId !== a.id ? `<div class="banner info">Vous êtes connecté en tant que <b>${esc(a.company_name)}</b>. <form method="post" action="/admin/retour"><button class="btn sm sec">Revenir à l'administration</button></form></div>` : '';
  const sim = req.simulation && !a.is_demo ? `<div class="banner">Mode simulation : aucun SMS ni e-mail réel n'est envoyé tant que la clé Brevo n'est pas configurée. Tout est quand même enregistré ici.</div>` : '';
  const demo = a.is_demo ? `<div class="banner info">👀 <b>Compte de démonstration</b> : les clients sont fictifs et aucun SMS ni e-mail n'est réellement envoyé. Cliquez partout, essayez « J'ai envoyé le devis » ou « Chantier terminé ». ${a.is_demo === 1 ? ' Ce compte s\'efface tout seul demain.' : ''}${a.is_demo === 1 ? ` <a class="btn sm" href="${esc(process.env.CONTACT_URL || '/inscription')}">Je veux ChauffPro</a>` : ''}</div>` : '';
  const flash = req.query.ok ? `<div class="flash">${esc(req.query.ok)}</div>` : req.query.err ? `<div class="flash err">${esc(req.query.err)}</div>` : '';
  return `${head(`${title} · ${APP_NAME()}`, null, { app: true })}<body><div class="shell"><nav class="side"><div class="brand">${esc(APP_NAME())}<small>${esc(a.company_name)}</small></div>
${nav.map(([h, l, k]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}
<form method="post" action="/deconnexion"><button>Se déconnecter</button></form></nav>
<main class="main">${imp}${demo}${sim}${flash}${body}</main></div><script src="/app.js" defer></script></body></html>`;
}

function publicLayout(title, body, { color, embed, app, lang } = {}) {
  return `${head(title, color, { app, lang })}<body${embed ? ' style="background:transparent"' : ''}><div class="pub"${embed ? ' style="padding:0"' : ''}>${body}</div></body></html>`;
}

const badge = (s) => { const x = STATUSES[s] || { label: s, color: '#868e96' }; return `<span class="badge" style="background:${x.color}">${esc(x.label)}</span>`; };
const fullName = (l) => esc([l.first_name, l.last_name].filter(Boolean).join(' ') || displayPhone(l.phone) || l.email || 'Sans nom');

module.exports = { head, appLayout, publicLayout, badge, fullName, APP_NAME };
