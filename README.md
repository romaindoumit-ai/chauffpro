# ChauffPro : le logiciel « plus de devis signés » pour chauffagistes

Une seule application web, avec un compte par artisan. Elle regroupe tout ce que vous vendez :

| Fonction | Ce que voit l'artisan | Ce que reçoit son client |
|---|---|---|
| **Formulaire de devis** | Chaque demande arrive dans son tableau de bord, avec une alerte par e-mail (et par SMS en option) | Un accusé de réception immédiat par SMS et par e-mail |
| **Relance automatique des devis** | Il clique sur « J'ai envoyé le devis » et indique le montant. C'est tout. | Des relances à J+2, J+7 et J+14 par SMS et par e-mail, avec des boutons « J'accepte », « Rappelez-moi » et « Je ne donne pas suite ». Les relances s'arrêtent dès qu'il répond. |
| **Avis Google** | Il clique sur « Chantier terminé » | Une demande d'avis 3 h plus tard, puis un rappel 4 jours après s'il n'a pas cliqué |
| **Appels manqués** | Une alerte « appel manqué » et une fiche créée automatiquement | Un SMS immédiat avec un lien pour demander un rendez-vous ou être rappelé |
| **Mini-site vitrine** | Un site prêt à l'emploi (`/s/nom-artisan`) avec le formulaire intégré | Un site propre, mobile, avec un bouton d'appel |
| **Bilan mensuel** | Envoyé automatiquement le 1er du mois : demandes, devis relancés, devis signés, chiffre d'affaires signé après relance, avis | – |

Côté **administration**, c'est vous : vous créez les comptes artisans, vous pouvez ouvrir n'importe quel compte pour le configurer à leur place, et vous voyez votre revenu mensuel récurrent.

Les délais (J+2, J+7, J+14…), les canaux (SMS et/ou e-mail) et **tous les textes** se modifient dans « Réglages », artisan par artisan.

---

## 1. Ce qu'il vous faut (environ 10 € par mois, plus les SMS)

1. **Un compte GitHub** pour stocker le code. C'est gratuit et vous l'avez déjà.
2. **Un hébergement sur [Render](https://render.com)**. L'offre « Starter » coûte environ 7 $ par mois, avec un disque de 1 Go à environ 0,25 $ par mois. Les serveurs sont à Francfort, donc dans l'UE.
3. **Un compte [Brevo](https://www.brevo.com)**, une entreprise française, pour envoyer les SMS et les e-mails.
   - E-mails : gratuit jusqu'à 300 par jour.
   - SMS : prépayés, environ 4 à 5 centimes l'unité en France. Comptez environ 150 SMS par mois pour un artisan actif, soit 6 à 8 € : c'est largement couvert par vos 99 €.
4. **Un nom de domaine**, environ 10 € par an chez OVH ou Gandi, par exemple `chauffpro.fr`. Il sert à l'adresse de l'application (`app.chauffpro.fr`) et à l'adresse d'envoi des e-mails.
5. *(Optionnel)* **Un compte [Twilio](https://www.twilio.com)** si vous voulez la version « message vocal + SMS » des appels manqués. Il faut alors un numéro Twilio par artisan, à environ 1 à 3 € par mois.

## 2. Mise en ligne (une seule fois, environ 30 minutes)

1. **Brevo**
   - Créez le compte.
   - Dans *Expéditeurs, domaines et IP dédiées*, ajoutez et validez votre domaine. Brevo vous donne 3 lignes à copier chez votre registrar.
   - Dans *SMS*, achetez un premier pack de crédits.
   - Dans *Paramètres › Clés API*, créez une clé et gardez-la.
2. **Render**
   - Cliquez sur *New + › Blueprint* et choisissez le dépôt GitHub de ce logiciel. Render lit le fichier `render.yaml` et prépare tout.
   - Remplissez les variables demandées :
     - `BASE_URL` : l'adresse finale, par exemple `https://app.chauffpro.fr`. Au début, vous pouvez mettre l'adresse `https://chauffpro-xxxx.onrender.com` que Render vous donne.
     - `ADMIN_EMAIL` et `ADMIN_PASSWORD` : vos identifiants d'administrateur.
     - `BREVO_API_KEY` : la clé Brevo.
     - `EMAIL_FROM` : par exemple `notifications@chauffpro.fr`. Ce doit être une adresse de votre domaine validé.
3. **Nom de domaine**
   - Dans Render, ouvrez *Settings › Custom Domains* et ajoutez `app.chauffpro.fr`.
   - Copiez la ligne CNAME que Render vous donne chez votre registrar.
   - Mettez à jour `BASE_URL`.
4. Ouvrez `https://app.chauffpro.fr/connexion` et connectez-vous avec vos identifiants d'administrateur.

> Tant que `BREVO_API_KEY` est vide, l'application tourne en **mode simulation**. Tout fonctionne et tout s'affiche, mais rien n'est réellement envoyé. C'est parfait pour faire une démo.

## 3. Mettre en place un nouvel artisan (15 à 20 minutes)

1. Dans **Administration › Ajouter un artisan**, renseignez l'entreprise, l'e-mail, le mobile et le prix de l'abonnement. Notez les identifiants affichés.
2. Cliquez sur **Ouvrir** pour entrer dans son compte, puis allez dans **Réglages**. Renseignez :
   - son **lien d'avis Google**. Dans son profil Google Business, c'est le bouton « Demander des avis » ; copiez le lien.
   - le **nom d'expéditeur SMS** : 11 caractères maximum, sans espace, par exemple `DupontChauf`.
   - sa ville, sa zone d'intervention, ses prestations et sa présentation, pour le mini-site.
3. Dans **Formulaire, site & appels**, récupérez :
   - le **lien du formulaire**, à mettre sur sa fiche Google, son Facebook et ses cartes de visite ;
   - ou le **code d'intégration**, si l'artisan a déjà un site (WordPress, Wix…) ;
   - ou le **mini-site**, s'il n'a pas de site : c'est votre offre « site web sur abonnement ».
4. **Appels manqués**, au choix :
   - **Avec Twilio** : achetez un numéro français. Dans *Phone Numbers › votre numéro › A call comes in*, choisissez *Webhook* et collez l'adresse affichée dans l'application. Ensuite, sur le mobile de l'artisan, composez `**61*NUMÉRO_TWILIO#` puis appel. Cela active le renvoi « si pas de réponse ». Pour le désactiver : `##61#`.
   - **Sans Twilio** : si l'artisan utilise un standard en ligne (Ringover, Aircall, OnOff…) ou Make/Zapier, branchez l'adresse « Option B » qui reçoit le numéro de l'appelant.
   - Le bouton **« Simuler un appel manqué »** permet de tester avec votre propre mobile.
5. Montrez-lui son quotidien : **« J'ai envoyé le devis »** (avec le montant) et **« Chantier terminé »**. Le logiciel s'occupe du reste.

## 4. Montrer l'outil à un prospect

Envoyez-lui simplement le lien **`https://app.chauffpro.fr/demo`** (ou cliquez sur « Voir la démo » sous l'écran de connexion).

- Chaque visiteur reçoit **son propre compte fictif** : un chauffagiste bruxellois avec 8 clients à tous les stades, des relances déjà parties, un appel manqué et un client à rappeler.
- Il peut tout essayer. **Aucun SMS ni e-mail n'est envoyé**, même quand la clé Brevo est configurée.
- Le compte s'efface tout seul après 24 heures. Les démos n'apparaissent pas dans votre administration.
- *(Optionnel)* Mettez dans la variable `CONTACT_URL` un lien vers vous (par exemple `https://wa.me/32470123456` ou `mailto:vous@chauffpro.be`) : un bouton « Je veux ChauffPro » s'affiche alors dans la démo.

Pour un compte de démonstration permanent (par exemple pour un rendez-vous), lancez `npm run demo` : il crée `demo@chauffpro.fr` / `demo1234`, qui n'envoie rien non plus.

## 5. Belgique et France

Le logiciel est réglé pour la **Belgique** par défaut. Chaque artisan peut passer en France dans Réglages › Mini-site › Pays.

- **Numéros** : `0470 12 34 56`, `+32 470…` ou `02 123 45 67` sont reconnus. Les SMS ne partent que vers les mobiles (04xx en Belgique, 06/07 en France). Un mobile français tapé dans un formulaire belge est aussi reconnu.
- **Jours fériés** : ceux du pays de l'artisan (en Belgique : 21 juillet, lundi de Pâques, Ascension, lundi de Pentecôte, etc.). Aucun message client ne part ces jours-là.
- **Mentions** : numéro d'entreprise (BCE), montants TVAC et Autorité de protection des données pour la Belgique ; SIRET, TTC et CNIL pour la France.

### Règles d'envoi déjà prises en compte

- **Horaires d'envoi** : les SMS et e-mails aux clients ne partent que du lundi au samedi, de 9 h à 19 h, hors jours fériés (Pâques et Pentecôte comprises). Un message prévu en dehors est décalé automatiquement. Les horaires se règlent par artisan, entre 8 h et 20 h.
- **STOP** : les relances et les demandes d'avis partent en SMS « marketing » chez Brevo, qui ajoute lui-même la mention « STOP au 3xxxx » et bloque les numéros désinscrits. L'application a aussi sa propre liste STOP : l'adresse « SMS entrants » est à brancher dans Brevo ou Twilio. Chaque e-mail contient un lien de désinscription.
- **Consentement** : une case est obligatoire sur les formulaires, avec un lien vers une page « Données personnelles » générée pour chaque artisan.
- **Droits RGPD** : chaque fiche client a un bouton « Supprimer ce client » (droit à l'effacement), et l'export CSV couvre la portabilité.
- **Appels manqués** : un seul SMS par numéro et par 24 h, aucun SMS vers un numéro fixe. Ces SMS partent de 8 h à 21 h, tous les jours, car ils répondent à un appel du client.
- **À faire de votre côté** :
  - un contrat de sous-traitance RGPD simple avec chaque artisan : vous traitez les données de ses clients pour son compte ;
  - des mentions légales et des CGV pour votre propre activité.

## 6. Pour les curieux : comment c'est fait

- **Node.js 22**, avec une seule dépendance (Express). La base de données est **SQLite**, intégrée à Node : un seul fichier, aucun serveur de base à gérer.
- Un planificateur interne vérifie chaque minute les messages à envoyer.
- `npm test` lance les tests automatiques : relances, avis, appels manqués, STOP, horaires et bilan.
- Sauvegarde : le fichier de base de données se trouve dans `/var/data` sur Render. Render fait des instantanés quotidiens du disque.

| Commande | Rôle |
|---|---|
| `npm install` | installer |
| `npm start` | lancer sur http://localhost:3000 |
| `npm run demo` | créer le compte de démonstration |
| `npm test` | tests automatiques |
