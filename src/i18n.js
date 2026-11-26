// Textes des pages vues par les clients, en français et en néerlandais.
// Les données enregistrées (type de projet, détails) restent en français pour l'artisan.
const LANGS = ['fr', 'nl'];

// Valeur enregistrée (FR) -> libellé affiché au client en NL
const WORK_TYPES_NL = {
  'Installation pompe à chaleur': 'Plaatsing warmtepomp',
  'Remplacement de chaudière': 'Vervanging verwarmingsketel',
  'Entretien ou dépannage chaudière': 'Onderhoud of herstelling ketel',
  'Entretien ou dépannage pompe à chaleur': 'Onderhoud of herstelling warmtepomp',
  'Chauffe-eau / ballon thermodynamique': 'Boiler / thermodynamische boiler',
  'Plancher chauffant / radiateurs': 'Vloerverwarming / radiatoren',
  'Climatisation': 'Airco',
  'Autre demande': 'Andere aanvraag',
};
// Choix du formulaire : [valeur enregistrée, libellé NL]
const OPTIONS = {
  housing: [['Maison', 'Huis'], ['Appartement', 'Appartement'], ['Local professionnel', 'Bedrijfsruimte']],
  energy: [['Je ne sais pas', 'Weet ik niet'], ['Mazout / fioul', 'Stookolie'], ['Gaz', 'Aardgas'], ['Électrique', 'Elektrisch'], ['Bois / granulés', 'Hout / pellets'], ['Pompe à chaleur', 'Warmtepomp']],
  delay: [['Urgent (panne)', 'Dringend (panne)'], ['Dans le mois', 'Binnen de maand'], ['Dans les 3 mois', 'Binnen 3 maanden'], ['Je me renseigne', 'Ik win informatie in']],
  slot: [['Matin (8h-12h)', 'Voormiddag (8u-12u)'], ['Après-midi (13h-18h)', 'Namiddag (13u-18u)'], ['Rappelez-moi dès que possible', 'Bel me zo snel mogelijk terug']],
};

const T = {
  fr: {
    not_found: 'Page introuvable', not_found_txt: "Ce lien n'existe pas ou a expiré.",
    quote_title: 'Demande de devis gratuit', quick: 'Réponse rapide', zone: 'Intervention',
    project: 'Votre projet', choose: 'Choisir…', housing: 'Type de logement', energy: 'Chauffage actuel', surface: 'Surface (m²)', delay: 'Délai souhaité',
    first_name: 'Prénom', last_name: 'Nom', mobile: 'Téléphone mobile', phone: 'Téléphone', email: 'E-mail', postal: 'Code postal', city: 'Ville', postal_city: 'Code postal / ville',
    details: 'Précisions (marque, problème, disponibilités…)', details_short: 'Précisions',
    consent: (c) => `J'accepte que ${c} me recontacte par téléphone, SMS ou e-mail au sujet de ma demande.`, privacy: 'Données personnelles',
    submit_quote: 'Recevoir mon devis gratuit', submit: 'Envoyer ma demande',
    too_many: 'Trop de demandes envoyées. Réessayez plus tard ou appelez-nous.', too_many_t: 'Trop de demandes',
    err_required: 'Merci de remplir les champs obligatoires.', err_phone: 'Le numéro de téléphone semble incorrect.', err_consent: 'Merci de cocher la case de consentement.',
    err_slot: "Ce créneau vient d'être réservé. Choisissez-en un autre.",
    thanks: 'Merci !', sent: '✅ Demande envoyée !', sent_txt: (c) => `Merci, ${c} a bien reçu votre demande et vous recontacte très vite.`,
    visit_booked: 'Votre visite est réservée :', visit_conf: 'Vous allez recevoir une confirmation.', urgent: 'Pour une urgence :',
    visit_legend: 'Choisissez un créneau pour la visite', optional: 'facultatif', visit_help: 'Le chauffagiste passe voir votre installation pour établir un devis précis.',
    more_dates: 'Plus de dates', no_pref: 'Pas de préférence, rappelez-moi',
    rdv_title: 'Être rappelé ou prendre rendez-vous', need: 'Votre besoin', day: 'Jour souhaité', slot: 'Créneau', rdv_consent: (c) => `J'accepte d'être recontacté par ${c} au sujet de ma demande.`,
    site_title: (city) => `Votre chauffagiste ${city ? 'à ' + city : 'de confiance'}`, site_about: 'Installation, remplacement et entretien de votre chauffage. Devis gratuit et rapide, intervention soignée.',
    site_cta: 'Demander un devis gratuit', services: 'Nos prestations', zone_title: "Zone d'intervention", reviews: 'Voir nos avis clients sur Google', legal: 'Mentions légales et données personnelles',
    quote: 'Votre devis', amount: 'Montant', ref: 'Réf.', answered: 'Votre réponse a bien été prise en compte. Merci !', where: 'Dites-nous simplement où vous en êtes :',
    c_ok: "✔ J'accepte le devis, contactez-moi pour fixer la date", c_rappel: "📞 J'ai une question, rappelez-moi", c_non: 'Je ne donne pas suite', or_call: 'Ou appelez directement le',
    m_ok: "Merci pour votre confiance ! Nous vous appelons très vite pour fixer la date d'intervention.", m_rappel: "C'est noté, nous vous rappelons rapidement.", m_non: "C'est noté, merci de nous avoir répondu. Nous ne vous relancerons plus.",
    unsub_t: 'Désinscription', unsub_h: "Ne plus recevoir d'e-mails", unsub_txt: (c) => `Vous ne recevrez plus d'e-mails de ${c}.`, unsub_btn: 'Confirmer la désinscription', unsub_done_h: "C'est fait", unsub_done: 'Votre désinscription est enregistrée.',
    // e-mails
    e_unsub: "Ne plus recevoir d'e-mails", e_ok: "✔ J'accepte le devis", e_rappel: 'Rappelez-moi', e_non: 'Je ne donne pas suite', e_avis: '⭐ Laisser un avis Google', e_slot: '📅 Choisir un créneau',
    your_work: 'vos travaux',
  },
  nl: {
    not_found: 'Pagina niet gevonden', not_found_txt: 'Deze link bestaat niet of is verlopen.',
    quote_title: 'Gratis offerte aanvragen', quick: 'Snel antwoord', zone: 'Werkgebied',
    project: 'Uw project', choose: 'Kies…', housing: 'Type woning', energy: 'Huidige verwarming', surface: 'Oppervlakte (m²)', delay: 'Gewenste termijn',
    first_name: 'Voornaam', last_name: 'Naam', mobile: 'Gsm-nummer', phone: 'Telefoon', email: 'E-mail', postal: 'Postcode', city: 'Gemeente', postal_city: 'Postcode / gemeente',
    details: 'Meer info (merk, probleem, beschikbaarheid…)', details_short: 'Meer info',
    consent: (c) => `Ik ga ermee akkoord dat ${c} mij per telefoon, sms of e-mail contacteert over mijn aanvraag.`, privacy: 'Persoonsgegevens',
    submit_quote: 'Mijn gratis offerte ontvangen', submit: 'Aanvraag versturen',
    too_many: 'Te veel aanvragen verstuurd. Probeer later opnieuw of bel ons.', too_many_t: 'Te veel aanvragen',
    err_required: 'Vul de verplichte velden in.', err_phone: 'Het telefoonnummer lijkt niet correct.', err_consent: 'Vink het toestemmingsvakje aan.',
    err_slot: 'Dit tijdslot werd net gereserveerd. Kies een ander.',
    thanks: 'Bedankt!', sent: '✅ Aanvraag verstuurd!', sent_txt: (c) => `Bedankt, ${c} heeft uw aanvraag goed ontvangen en neemt snel contact met u op.`,
    visit_booked: 'Uw bezoek is gereserveerd:', visit_conf: 'U ontvangt een bevestiging.', urgent: 'Dringend?',
    visit_legend: 'Kies een tijdslot voor het bezoek', optional: 'optioneel', visit_help: 'De vakman komt uw installatie bekijken om een nauwkeurige offerte op te maken.',
    more_dates: 'Meer data', no_pref: 'Geen voorkeur, bel me terug',
    rdv_title: 'Teruggebeld worden of een afspraak maken', need: 'Wat heeft u nodig?', day: 'Gewenste dag', slot: 'Tijdslot', rdv_consent: (c) => `Ik ga ermee akkoord dat ${c} mij contacteert over mijn aanvraag.`,
    site_title: (city) => `Uw verwarmingsvakman ${city ? 'in ' + city : 'om op te rekenen'}`, site_about: 'Plaatsing, vervanging en onderhoud van uw verwarming. Snelle en gratis offerte, verzorgd werk.',
    site_cta: 'Gratis offerte aanvragen', services: 'Onze diensten', zone_title: 'Werkgebied', reviews: 'Bekijk onze klantenreviews op Google', legal: 'Wettelijke vermeldingen en persoonsgegevens',
    quote: 'Uw offerte', amount: 'Bedrag', ref: 'Ref.', answered: 'Uw antwoord werd goed ontvangen. Bedankt!', where: 'Laat ons gewoon weten hoe het staat:',
    c_ok: '✔ Ik aanvaard de offerte, contacteer me om een datum te plannen', c_rappel: '📞 Ik heb een vraag, bel me terug', c_non: 'Ik ga er niet op in', or_call: 'Of bel rechtstreeks naar',
    m_ok: 'Bedankt voor uw vertrouwen! We bellen u snel om een datum af te spreken.', m_rappel: 'Genoteerd, we bellen u snel terug.', m_non: 'Genoteerd, bedankt voor uw antwoord. We sturen u geen herinneringen meer.',
    unsub_t: 'Uitschrijven', unsub_h: 'Geen e-mails meer ontvangen', unsub_txt: (c) => `U ontvangt geen e-mails meer van ${c}.`, unsub_btn: 'Uitschrijving bevestigen', unsub_done_h: 'Gelukt', unsub_done: 'Uw uitschrijving is geregistreerd.',
    e_unsub: 'Geen e-mails meer ontvangen', e_ok: '✔ Ik aanvaard de offerte', e_rappel: 'Bel me terug', e_non: 'Ik ga er niet op in', e_avis: '⭐ Laat een Google-review achter', e_slot: '📅 Kies een tijdslot',
    your_work: 'uw werken',
  },
};

const PRIVACY = {
  fr: (a) => ({
    title: 'Mentions légales et données personnelles',
    rows: [
      ['Éditeur', a.editor], ['Données collectées', "nom, prénom, téléphone, e-mail, adresse et description de votre projet, uniquement pour répondre à votre demande (devis, prise de rendez-vous, suivi de votre devis, demande d'avis après intervention)."],
      ['Base légale', 'votre consentement et les mesures précontractuelles prises à votre demande.'], ['Durée de conservation', '3 ans après le dernier contact, puis suppression.'],
      ['Destinataires', `${a.company} et ses sous-traitants techniques (hébergement, envoi de SMS et d'e-mails), situés dans l'Union européenne. Vos données ne sont jamais vendues.`],
      ['Vos droits', `accès, rectification, effacement, opposition. Écrivez à ${a.email}. Vous pouvez répondre STOP à tout SMS et utiliser le lien de désinscription présent dans chaque e-mail. Vous pouvez aussi introduire une réclamation auprès de ${a.authority}.`],
    ],
  }),
  nl: (a) => ({
    title: 'Wettelijke vermeldingen en persoonsgegevens',
    rows: [
      ['Uitgever', a.editor], ['Verzamelde gegevens', 'naam, voornaam, telefoon, e-mail, adres en beschrijving van uw project, enkel om uw aanvraag te beantwoorden (offerte, afspraak, opvolging van uw offerte, vraag om een review na de werken).'],
      ['Rechtsgrond', 'uw toestemming en de precontractuele maatregelen op uw verzoek.'], ['Bewaartermijn', '3 jaar na het laatste contact, daarna worden ze gewist.'],
      ['Ontvangers', `${a.company} en zijn technische onderaannemers (hosting, verzending van sms'en en e-mails), gevestigd in de Europese Unie. Uw gegevens worden nooit verkocht.`],
      ['Uw rechten', `inzage, verbetering, wissing, bezwaar. Schrijf naar ${a.email}. U kunt op elke sms STOP antwoorden en de uitschrijflink in elke e-mail gebruiken. U kunt ook klacht indienen bij ${a.authority}.`],
    ],
  }),
};
const AUTHORITY_NL = { BE: 'de Gegevensbeschermingsautoriteit (gegevensbeschermingsautoriteit.be)', FR: 'de CNIL (cnil.fr)' };

const norm = (l) => (LANGS.includes(String(l || '').toLowerCase()) ? String(l).toLowerCase() : null);
/** Langue de la page : ?lang=nl, sinon champ de formulaire, sinon langue du navigateur, sinon français. */
function pickLang(req, fallback) {
  const q = norm(req.query && req.query.lang) || norm(req.body && req.body.lang);
  if (q) return q;
  if (fallback) return norm(fallback) || 'fr';
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  return /^nl\b/.test(al.trim()) ? 'nl' : 'fr';
}
function t(lang) {
  const d = T[norm(lang) || 'fr'];
  return (key, ...args) => { const v = d[key] ?? T.fr[key] ?? key; return typeof v === 'function' ? v(...args) : v; };
}
const workLabel = (w, lang) => (lang === 'nl' ? WORK_TYPES_NL[w] || w : w);
const option = (name, value, lang) => { const o = (OPTIONS[name] || []).find(([fr]) => fr === value); return o ? (lang === 'nl' ? o[1] : o[0]) : value; };
const locale = (lang) => (lang === 'nl' ? 'nl-BE' : 'fr-FR');

module.exports = { LANGS, T, OPTIONS, WORK_TYPES_NL, PRIVACY, AUTHORITY_NL, pickLang, t, workLabel, option, locale };
