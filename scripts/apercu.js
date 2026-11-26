// Fabrique l'aperçu gratuit de ChauffPro : une seule page HTML, sans serveur, à envoyer par lien aux chauffagistes.
// Les pages sont celles de la vraie appli (compte de démonstration « Dupont Chauffage »), figées et reliées entre elles.
// Usage : npm run apercu   ->   docs/index.html (publié par GitHub Pages)
process.removeAllListeners('warning');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apercu-'));
process.env.DATABASE_FILE = path.join(tmp, 'apercu.db');
process.env.COUNTRY = 'BE';
process.env.BASE_URL = 'https://chauffpro.be'; // adresse affichée dans les exemples de messages
delete process.env.BREVO_API_KEY; delete process.env.STRIPE_SECRET_KEY; delete process.env.ANTHROPIC_API_KEY;

const { openDb } = require('../src/db');
const { createApp } = require('../src/server');
const { seedDemo } = require('../src/demo');
const AI = require('../src/ai');
const U = require('../src/util');

const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'index.html');
const SLUG = 'dupont-chauffage';
// L'assistant IA est montré tel qu'il apparaît quand il est activé (aucun appel réel n'est fait ici).
AI._client = { beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Exemple' }] }) } } };

(async () => {
  const db = openDb();
  await seedDemo(db, { email: 'apercu@demo.invalid', slug: SLUG, password: 'apercu-demo', isDemo: 2 });
  const account = db.prepare('SELECT * FROM accounts WHERE slug=?').get(SLUG);
  const leads = db.prepare('SELECT * FROM leads WHERE account_id=? ORDER BY created_at DESC').all(account.id);
  const fresh = leads.find((l) => l.status === 'nouveau' && l.first_name && l.work_type) || leads.find((l) => l.status === 'nouveau') || leads[0];
  db.prepare('UPDATE leads SET ai_summary=?, ai_draft=? WHERE id=?').run(
    `• ${fresh.work_type || 'Demande de devis'} : client pressé, à rappeler aujourd'hui.\n• À vérifier : marque et âge de l'installation actuelle, accès à la chaufferie.\n• À prévoir pour la visite : photos de la plaque signalétique, surface à chauffer.`,
    `Bonjour ${fresh.first_name || ''}, merci pour votre demande. Je peux passer voir votre installation cette semaine pour établir le devis. Quel moment vous arrange ? ${(account.owner_name || '').split(' ')[0] || account.company_name}`,
    fresh.id);

  const server = createApp(db).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/connexion`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=apercu%40demo.invalid&password=apercu-demo' });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('Connexion au compte de démonstration impossible');

  const lead = (l) => `/app/demandes/${l.id}`;
  const withVisit = leads.find((l) => l.visit_at);
  const quoted = leads.find((l) => l.status === 'devis_envoye') || leads[0];
  // [adresse, identifiant, libellé dans la barre du haut]
  const pages = [
    ['/app', 'p-app', 'Espace du chauffagiste · Tableau de bord'],
    ['/app/demandes', 'p-demandes', 'Espace du chauffagiste · Demandes & devis'],
    ...leads.map((l, i) => [lead(l), `p-lead-${i + 1}`, 'Espace du chauffagiste · Fiche client']),
    ['/app/demandes/nouvelle', 'p-nouvelle', 'Espace du chauffagiste · Ajouter un client'],
    ['/app/messages', 'p-messages', 'Espace du chauffagiste · Messages programmés'],
    ['/app/rapport', 'p-rapport', 'Espace du chauffagiste · Bilan mensuel'],
    ['/app/integration', 'p-integration', 'Espace du chauffagiste · Formulaire, site & appels'],
    ['/app/avis-google', 'p-avis-ia', 'Espace du chauffagiste · Réponses aux avis (IA)'],
    ['/app/appli', 'p-appli', 'Espace du chauffagiste · Appli & notifications'],
    ['/app/reglages', 'p-reglages', 'Espace du chauffagiste · Réglages'],
    [`/f/${SLUG}`, 'p-formulaire', 'Ce que voit le client · Formulaire de devis'],
    [`/f/${SLUG}?lang=nl`, 'p-formulaire-nl', 'Ce que voit le client · Formulaire en néerlandais'],
    [`/f/${SLUG}/merci`, 'p-merci', 'Ce que voit le client · Confirmation'],
    [`/f/${SLUG}/merci?lang=nl`, 'p-merci-nl', 'Ce que voit le client · Confirmation (NL)'],
    [`/s/${SLUG}`, 'p-site', 'Ce que voit le client · Mini-site'],
    [`/s/${SLUG}?lang=nl`, 'p-site-nl', 'Ce que voit le client · Mini-site (NL)'],
    [`/s/${SLUG}/confidentialite`, 'p-confidentialite', 'Ce que voit le client · Données personnelles'],
    [`/c/${quoted.token}`, 'p-devis-client', 'Ce que voit le client · Réponse au devis'],
    [`/rdv/${SLUG}`, 'p-rdv', 'Ce que voit le client · Rappel après un appel manqué'],
    ['/inscription', 'p-inscription', 'Inscription et formules'],
  ];
  const ids = new Map(pages.map(([u, id]) => [u, id]));
  const html = {};
  for (const [u, id] of pages) {
    const r = await fetch(base + u, { headers: { cookie }, redirect: 'manual' });
    if (r.status !== 200) throw new Error(`${u} : ${r.status}`);
    html[id] = await r.text();
  }
  server.close();

  // Où mène chaque formulaire dans l'aperçu (sinon : petit message « dans la vraie version… »).
  const formGo = (pageUrl, action) => {
    const a = new URL(action || pageUrl, base + pageUrl);
    if (/^\/f\/[^/]+$/.test(a.pathname) || /^\/s\//.test(pageUrl)) return pageUrl.includes('lang=nl') ? '#p-merci-nl' : '#p-merci';
    return '';
  };
  const linkTo = (pageUrl, href) => {
    if (href.startsWith(process.env.BASE_URL)) href = href.slice(process.env.BASE_URL.length) || '/';
    if (/^(https?:|mailto:|tel:|sms:|#)/.test(href) && !href.startsWith(base)) return href.startsWith('#') ? href : null;
    const a = new URL(href, base + pageUrl);
    if (a.origin !== base) return null;
    const key = a.pathname + a.search;
    if (ids.has(key)) return `#${ids.get(key)}`;
    if (['/demo', '/connexion', '/'].includes(a.pathname)) return '#p-index';
    if (ids.has(a.pathname) && a.search) return `#${ids.get(a.pathname)}`; // filtres de liste : même page
    return '#!';
  };

  const sections = pages.map(([u, id, title]) => {
    let h = html[id];
    const color = (h.match(/<style>:root\{--c:([^}]+)\}<\/style>/) || [])[1];
    let body = h.slice(h.indexOf('<body') + 5);
    body = body.slice(body.indexOf('>') + 1, body.lastIndexOf('</body>'));
    body = body.replace(/<script[\s\S]*?<\/script>/g, '');
    body = body.replace(/(<a\b[^>]*?\bhref=")([^"]*)(")/g, (m, a, href, z) => {
      const t = linkTo(u, href.replace(/&amp;/g, '&'));
      return t === null ? m.replace(/<a\b/, '<a target="_blank" rel="noopener"') : a + t + z;
    });
    body = body.replace(/onclick="location='([^']*)'"/g, (m, href) => { const t = linkTo(u, href); return t && t !== '#!' ? `onclick="location.hash='${t}'"` : ''; });
    body = body.replace(/<form\b([^>]*)>/g, (m, attrs) => {
      const action = (attrs.match(/\baction="([^"]*)"/) || [])[1];
      const go = formGo(u, action && action.replace(/&amp;/g, '&'));
      const msg = u === '/inscription' ? ' data-msg="Aperçu : dans la vraie version, votre compte est créé ici et vous passez au paiement sécurisé."' : '';
      return `<form${attrs.replace(/\s(action|method)="[^"]*"/g, '')}${go ? ` data-go="${go}"` : ''}${msg}>`;
    });
    body = body.replace(/(<p id="pwa-status"[^>]*>)[^<]*/, '$1Dans la vraie version, ce bouton active les notifications sur le téléphone du chauffagiste.');
    // Le bandeau « compte de démonstration » adapté à l'aperçu.
    body = body.replace(/<div class="banner info">👀[\s\S]*?<\/div>/, '<div class="banner info">👀 <b>Aperçu de démonstration</b> : Dupont Chauffage est un chauffagiste fictif à Bruxelles. Les boutons ne font rien ici ; dans la vraie version, tout est enregistré et les SMS et e-mails partent pour de vrai.</div>');
    const style = color ? ` style="--c:${color}"` : '';
    return `<section id="${id}" class="pg"${style}><div class="demobar"><a href="#p-index">← Sommaire</a><span>${U.esc(title)}</span></div>${body}</section>`;
  });

  const L = (id, label, sub) => `<a class="tile" href="#${id}"><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</a>`;
  const index = `<section id="p-index" class="pg idx"><div class="hero"><div class="in">
<img src="data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, '..', 'public', 'icons', 'icon.svg')).toString('base64')}" alt="" width="64" height="64">
<h1>ChauffPro</h1>
<p class="lead">Le logiciel qui fait le suivi commercial à la place du chauffagiste : chaque demande de devis est enregistrée, relancée par SMS et e-mail, et chaque chantier terminé se transforme en avis Google.</p>
<p class="small">Voici un aperçu cliquable avec un chauffagiste fictif à Bruxelles, <b>Dupont Chauffage</b>. Rien n'est envoyé, rien à installer.</p>
<p><a class="btn big" href="#p-app">Voir l'espace du chauffagiste</a> <a class="btn big light" href="#p-formulaire">Voir ce que voit le client</a></p>
</div></div>
<div class="in">
<h2>Ce que ChauffPro fait pour vous</h2>
<div class="feats">
<div><b>📥 Toutes les demandes au même endroit</b><p>Formulaire de devis, mini-site, appels manqués : tout arrive dans un tableau de bord clair, avec une notification sur le téléphone.</p></div>
<div><b>🔁 Relances automatiques des devis</b><p>Le client qui n'a pas répondu reçoit un SMS puis un e-mail, au bon moment. Il accepte le devis en un clic.</p></div>
<div><b>📅 Visites réservées en ligne</b><p>Le client choisit lui-même un créneau libre pour la visite. Il reçoit un rappel la veille.</p></div>
<div><b>⭐ Avis Google</b><p>Après le chantier, le client est invité à laisser un avis. Les avis font venir les clients suivants.</p></div>
<div><b>🔧 Rappel d'entretien annuel</b><p>Un an après l'intervention, le client reçoit un rappel pour l'entretien de sa chaudière. Du travail qui revient tout seul.</p></div>
<div><b>📞 Appel manqué = SMS automatique</b><p>Vous êtes sur un chantier ? Le client reçoit un SMS avec un lien pour demander à être rappelé.</p></div>
<div><b>🇧🇪 Français et néerlandais</b><p>Formulaire, mini-site et messages en néerlandais pour les clients flamands. Numéros belges, jours fériés belges.</p></div>
<div><b>✨ Assistant IA</b><p>Résumé de la demande en 3 lignes, brouillon de réponse au client, réponse aux avis Google. Vous relisez, vous décidez.</p></div>
</div>
<h2>Visitez l'aperçu</h2>
<h3>L'espace du chauffagiste</h3>
<div class="tiles">
${L('p-app', 'Tableau de bord', 'à traiter, prochaines visites')}${L('p-demandes', 'Demandes & devis', 'tous les clients, par statut')}${L(ids.get(lead(fresh)), 'Fiche d\'une nouvelle demande', 'avec l\'assistant IA')}${withVisit ? L(ids.get(lead(withVisit)), 'Fiche avec une visite prévue', 'ajout à l\'agenda en un clic') : ''}${L('p-messages', 'Messages programmés', 'relances, rappels, entretien')}${L('p-rapport', 'Bilan mensuel', 'chiffre d\'affaires signé, taux de réussite')}${L('p-integration', 'Formulaire, site & appels', 'à mettre sur Facebook ou Google')}${L('p-avis-ia', 'Répondre aux avis Google', 'avec l\'IA')}${L('p-appli', 'Appli sur le téléphone', 'et notifications')}${L('p-reglages', 'Réglages', 'textes, horaires, créneaux de visite')}
</div>
<h3>Ce que voit le client</h3>
<div class="tiles">
${L('p-formulaire', 'Formulaire de devis', 'avec choix du créneau de visite')}${L('p-formulaire-nl', 'Formulaire en néerlandais', 'Offerteaanvraag')}${L('p-site', 'Mini-site du chauffagiste', 'FR · NL')}${L('p-devis-client', 'Réponse au devis', 'accepter en un clic')}${L('p-rdv', 'Rappel après un appel manqué', '')}
</div>
<h3>Les formules</h3>
<div class="tiles">${L('p-inscription', 'Formules et inscription', 'Essentiel 79 €/mois · Complet 129 €/mois')}</div>
<p class="small muted foot">Aperçu généré le ${new Date().toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric' })}. Les dates de visite proposées sont celles de ce jour-là.</p>
</div></section>`;

  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const out = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aperçu ChauffPro</title><meta name="description" content="Aperçu cliquable de ChauffPro, le logiciel de suivi des devis pour chauffagistes.">
<link rel="icon" href="data:image/svg+xml;base64,${fs.readFileSync(path.join(__dirname, '..', 'public', 'icons', 'icon.svg')).toString('base64')}">
<style>${css}
.pg{display:none;min-height:100vh}.pg.on{display:block}
.demobar{position:sticky;top:0;z-index:50;display:flex;gap:12px;align-items:center;background:#1f2933;color:#fff;padding:8px 14px;font-size:14px}
.demobar a{color:#ffd8a8;font-weight:600;text-decoration:none;white-space:nowrap}.demobar span{opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.demotoast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);opacity:0;pointer-events:none;background:#1f2933;color:#fff;padding:12px 18px;border-radius:10px;font-size:14px;transition:.25s;max-width:calc(100% - 32px);z-index:99;box-shadow:0 6px 24px rgba(0,0,0,.2)}
.demotoast.on{opacity:1;transform:translateX(-50%)}
.idx{background:#f6f7f9;color:#1f2933}.idx .in{max-width:960px;margin:0 auto;padding:0 16px}
.idx .hero{background:linear-gradient(135deg,#d9480f,#f76707);color:#fff;padding:48px 0 40px}.idx .hero img{border-radius:14px;background:#fff}
.idx h1{font-size:40px;margin:12px 0 8px}.idx .lead{font-size:19px;line-height:1.5;max-width:720px}.idx .hero .small{opacity:.9}
.idx h2{margin:40px 0 14px}.idx h3{margin:24px 0 10px;color:#495057;font-size:16px;text-transform:uppercase;letter-spacing:.04em}
.btn.big{padding:14px 20px;font-size:16px;margin:6px 6px 0 0;display:inline-block;background:#fff;color:#d9480f}.btn.big.light{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.6)}
.feats{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.feats>div{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.feats p{margin:6px 0 0;color:#495057;font-size:14px;line-height:1.45}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.tile{display:block;background:#fff;border:1px solid #e9ecef;border-radius:12px;padding:14px;text-decoration:none;color:#1f2933}.tile:hover{border-color:#d9480f}
.tile span{display:block;color:#868e96;font-size:13px;margin-top:4px}.idx .foot{margin:40px 0;padding-bottom:20px}
</style></head><body>
${index}
${sections.join('\n')}
<div class="demotoast" id="demotoast">Aperçu : dans la vraie version, cette action est enregistrée.</div>
<script>{
const show=()=>{const h=(location.hash||'#p-index').slice(1);const el=document.getElementById(h)||document.getElementById('p-index');document.querySelectorAll('.pg').forEach(s=>s.classList.toggle('on',s===el));window.scrollTo(0,0)};
addEventListener('hashchange',show);show();
const t=document.getElementById('demotoast');const msg0=t.textContent;const toast=(m)=>{t.textContent=m||msg0;t.classList.add('on');clearTimeout(window._dt);window._dt=setTimeout(()=>t.classList.remove('on'),2600)};
document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&a.getAttribute('href')==='#!'){e.preventDefault();toast()}});
document.addEventListener('submit',e=>{const f=e.target;e.preventDefault();const go=f.getAttribute('data-go');if(go){location.hash=go.slice(1);return}toast(f.getAttribute('data-msg'))},true);
}</script></body></html>
`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`Aperçu écrit : ${OUT} (${Math.round(out.length / 1024)} Ko, ${pages.length} pages)`);
})().catch((e) => { console.error(e); process.exit(1); });
