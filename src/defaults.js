// Réglages et textes par défaut. Chaque artisan peut les modifier dans « Réglages ».
const DEFAULT_SETTINGS = {
  window: { start: 9, end: 19 },
  relances: { enabled: true, days: [2, 7, 14], sms: true, email: true },
  avis: { enabled: true, delay_hours: 3, reminder_days: 4, sms: true, email: true },
  appel: { enabled: true },
  entretien: { enabled: true, months: 12, sms: true, email: true }, // rappel d'entretien après « Chantier terminé »
  confirmation: { enabled: true, sms: true, email: true },
  notif: { email: true, sms: false },
  rapport: { enabled: true },
  sms_footer: '', // Brevo ajoute lui-même « STOP au 3xxxx » aux SMS marketing (relances, avis)
  templates: {
    confirmation_sms: "Bonjour {prenom}, {entreprise} a bien reçu votre demande ({travaux}). Nous revenons vers vous très vite. Tél : {tel}",
    confirmation_email_subject: "Nous avons bien reçu votre demande",
    confirmation_email: "Bonjour {prenom},\n\nMerci pour votre demande concernant : {travaux}.\nNous l'étudions et revenons vers vous très rapidement pour convenir d'une visite ou vous envoyer un devis.\n\nÀ très vite,\n{artisan}\n{entreprise} · {tel}",

    relance_1_sms: "Bonjour {prenom}, c'est {artisan} de {entreprise}. Avez-vous pu regarder notre devis ({travaux}) ? Vous pouvez me répondre en 1 clic : {lien}",
    relance_1_email_subject: "Votre devis {entreprise} : avez-vous pu le consulter ?",
    relance_1_email: "Bonjour {prenom},\n\nJe me permets de revenir vers vous au sujet du devis {ref} ({travaux}{montant_txt}) que nous vous avons envoyé.\n\nAvez-vous pu le consulter ? Si vous avez la moindre question, je suis à votre disposition.\n\nBien cordialement,\n{artisan}\n{entreprise} · {tel}",

    relance_2_sms: "Bonjour {prenom}, je reviens vers vous pour le devis {travaux}. Une question ou un ajustement à faire ? Répondez ici : {lien} ou appelez le {tel}. {entreprise}",
    relance_2_email_subject: "Une question sur votre devis ?",
    relance_2_email: "Bonjour {prenom},\n\nJe reviens vers vous concernant votre projet ({travaux}). Si certains points du devis ne sont pas clairs ou si vous souhaitez l'ajuster (matériel, options, délais), je peux vous rappeler.\n\nUtilisez simplement les boutons ci-dessous pour me dire où vous en êtes.\n\nBien cordialement,\n{artisan}\n{entreprise} · {tel}",

    relance_3_sms: "Bonjour {prenom}, dernier petit message pour notre devis {travaux}. Si le projet est toujours d'actualité, on peut caler une date : {lien}. Sinon pas de souci ! {entreprise}",
    relance_3_email_subject: "Votre projet est-il toujours d'actualité ?",
    relance_3_email: "Bonjour {prenom},\n\nC'est mon dernier message au sujet du devis {ref} ({travaux}).\nSi votre projet est toujours d'actualité, nous pouvons fixer une date d'intervention. S'il a été reporté ou confié à quelqu'un d'autre, dites-le-moi simplement en un clic, je ne vous relancerai plus.\n\nMerci et bonne journée,\n{artisan}\n{entreprise} · {tel}",

    avis_sms: "Bonjour {prenom}, merci pour votre confiance ! Si vous êtes satisfait de l'intervention, un avis Google nous aiderait beaucoup (1 minute) : {lien_avis} {artisan}, {entreprise}",
    avis_email_subject: "Merci ! Votre avis compte pour nous",
    avis_email: "Bonjour {prenom},\n\nMerci d'avoir fait appel à {entreprise} pour votre {travaux}.\nSi vous êtes satisfait de notre travail, pourriez-vous prendre une minute pour laisser un avis Google ? Cela aide énormément une entreprise locale comme la nôtre.\n\nMerci beaucoup,\n{artisan}",
    avis_relance_sms: "Bonjour {prenom}, petit rappel : si vous avez une minute, votre avis Google nous aiderait vraiment : {lien_avis} Merci ! {entreprise}",

    entretien_sms: "Bonjour {prenom}, c'est {artisan} de {entreprise}. C'est le moment de prévoir l'entretien de votre installation ({travaux}). Choisissez un créneau ici : {lien_rdv} ou appelez le {tel}.",
    entretien_email_subject: "C'est le moment de l'entretien de votre installation",
    entretien_email: "Bonjour {prenom},\n\nVotre installation ({travaux}) arrive à la date de son entretien.\nUn entretien régulier garde votre installation sûre et économe, et il est souvent exigé par la garantie et par la réglementation.\n\nChoisissez simplement un jour et un créneau avec le bouton ci-dessous, nous vous confirmons le passage.\n\nÀ bientôt,\n{artisan}\n{entreprise} · {tel}",

    appel_sms: "Bonjour, c'est {entreprise}. Désolé, je suis en intervention et n'ai pas pu décrocher. Indiquez votre besoin et vos disponibilités ici, je vous rappelle vite : {lien_rdv}",
    appel_vocal: "Bonjour, vous êtes bien chez {entreprise}. Nous sommes en intervention. Vous allez recevoir un SMS pour prendre rendez-vous. Merci et à très vite.",
  },
};

const STATUSES = {
  nouveau: { label: 'Nouvelle demande', color: '#1c7ed6' },
  rdv: { label: 'Visite prévue', color: '#7048e8' },
  devis_envoye: { label: 'Devis envoyé (relances actives)', color: '#f08c00' },
  accepte: { label: 'Devis signé', color: '#2f9e44' },
  termine: { label: 'Chantier terminé', color: '#0b7285' },
  refuse: { label: 'Refusé', color: '#868e96' },
  perdu: { label: 'Sans suite', color: '#868e96' },
};

const SOURCES = { formulaire: 'Formulaire de devis', site: 'Site web', appel: 'Appel manqué', rdv: 'Demande de RDV', manuel: 'Saisie manuelle' };

const KINDS = {
  confirmation: 'Accusé de réception', relance_1: 'Relance 1', relance_2: 'Relance 2', relance_3: 'Relance 3',
  avis: "Demande d'avis", avis_relance: "Rappel d'avis", entretien: "Rappel d'entretien", appel: 'SMS appel manqué', notif: 'Alerte artisan', rapport: 'Bilan mensuel',
};

function mergeSettings(raw) {
  let s = {};
  try { s = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { s = {}; }
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const k of Object.keys(s)) {
    if (out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) Object.assign(out[k], s[k]);
    else out[k] = s[k];
  }
  return out;
}

module.exports = { DEFAULT_SETTINGS, STATUSES, SOURCES, KINDS, mergeSettings };
