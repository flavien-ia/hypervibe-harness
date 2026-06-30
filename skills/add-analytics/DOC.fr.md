# /add-analytics

Active **Google Analytics** sur votre site, avec une **bannière cookies RGPD-compliant** (consentement obligatoire avant tout tracking).

## Quand l'utiliser

- Vous voulez **mesurer l'audience** de votre site (nombre de visiteurs, pages les plus vues, sources de trafic, durée de visite)
- Vous voulez **respecter le RGPD** sans devoir tout configurer à la main
- Vous voulez recevoir un **rapport régulier par email** (hebdo ou mensuel) avec vos statistiques

## Comment ça se passe

1. **Vérification** : si GA4 est déjà en place, Hypervibe vous propose un menu (changer de propriété GA, réinstaller la bannière cookies, configurer un rapport email, etc.).

2. **Conseil sur le domaine** : si vous êtes encore sur une URL Vercel, Hypervibe vous recommande de connecter votre vrai domaine d'abord (`/add-domain`). Possible quand même de continuer avec l'URL Vercel, vous mettrez à jour le flux web côté GA4 plus tard.

3. **Récupération de l'identifiant de mesure (G-XXXXXXXXXX)** :
  - Si vous n'avez jamais utilisé GA, Hypervibe vous guide pour créer un compte sur analytics.google.com
  - Si vous en avez déjà un, elle vous indique comment **ajouter une nouvelle propriété** à votre compte existant
  - Vous copiez-collez le `G-XXXXXXXXXX` dans le chat

4. **Push de la variable** : `NEXT_PUBLIC_GA_MEASUREMENT_ID` est poussé dans `.env` + Vercel.

5. **Création du composant GoogleAnalytics** : un composant React qui charge GA4 **seulement après acceptation des cookies** (jamais avant). Si le visiteur accepte plus tard, GA se charge instantanément sans recharger la page. Le composant **exclut automatiquement les routes d'administration** (`/admin`) du suivi, et Hypervibe vous propose d'exclure aussi vos espaces authentifiés (dashboard, espace membres, compte) - pour que vos propres visites et celles de vos clients connectés ne polluent pas vos statistiques d'acquisition.

6. **Création de la bannière de consentement** : petit popup discret en bas à gauche (max-width small, fond sombre semi-transparent, couleur d'accent de votre site sur le bouton "Accepter"). Le wording est volontairement générique (*"Ce site utilise des cookies à des fins de mesure d'audience."*). Ça reste valide même si vous ajoutez d'autres trackers plus tard.

7. **Mise à jour des pages légales** : Hypervibe met automatiquement à jour votre politique de confidentialité pour mentionner GA4 et expliquer le droit de retrait du consentement.

8. **Rapport par email (optionnel)** : Hypervibe vous propose et vous **guide clic-par-clic** pour activer un rapport planifié GA4 (Pages les plus vues, Acquisition, Engagement…) envoyé à votre boîte mail toutes les semaines ou tous les mois. C'est 100 % UI GA4, Hypervibe ne peut pas le configurer pour vous, mais elle vous donne le pas-à-pas.

## Ce que ça crée pour vous

- Une **propriété Google Analytics** à votre nom (ou une nouvelle propriété dans votre compte existant)
- La variable `NEXT_PUBLIC_GA_MEASUREMENT_ID` dans `.env` + Vercel
- Un composant `GoogleAnalytics` qui ne charge GA qu'après acceptation des cookies, et qui n'active pas le tracking sur les routes d'administration (ni sur les espaces authentifiés que vous choisissez d'exclure)
- Un composant `CookieConsent` (bannière) avec le design de votre site
- Une mise à jour de la **politique de confidentialité** pour mentionner GA
- Si vous le voulez : un **rapport email régulier** GA4 (configuration UI, guidée)

## Prérequis

- Le projet doit être en Next.js (typiquement initialisé par `/bootstrap`)
- Un compte Google (gratuit)

## Astuces

{{callout:warning|RGPD : le tracking ne démarre qu'après acceptation}}
La bannière est obligatoire pour la conformité RGPD. Les cookies GA ne sont **jamais** déposés avant que le visiteur clique "Accepter". S'il clique "Refuser" ou ferme la bannière, aucun tracking. Tout ça est intégré par défaut. Vous n'avez rien à coder.
{{/callout}}

{{callout:tip|Rapport par email = précieux pour ne pas oublier}}
Si vous n'ouvrez pas Google Analytics chaque semaine, le rapport par email est très utile. Hypervibe vous guide pour activer le rapport **Pages et écrans** (les pages les plus vues), un classique. Vous pouvez en ajouter d'autres ensuite : Acquisition (d'où viennent les visiteurs), Données démographiques (pays, appareils, etc.).
{{/callout}}

{{callout:info|Pourquoi un wording générique}}
La bannière dit "mesure d'audience" sans nommer GA4 spécifiquement. C'est exprès : le jour où vous ajoutez Meta Pixel ou Hotjar, le texte couvre déjà. Pas besoin de remettre à jour la bannière à chaque nouveau tracker.
{{/callout}}

{{callout:tip|Vos visites admin ne faussent pas vos stats}}
Le tracking est désactivé sur les routes d'administration (`/admin`) : quand vous gérez votre site, vos propres sessions ne sont pas comptées comme des visiteurs. Vous pouvez étendre cette exclusion à vos espaces authentifiés (dashboard, espace membres, compte) - Hypervibe vous le propose pendant l'installation. Déjà installé avant cette amélioration ? Relancez `/add-analytics` et choisissez "Exclure les routes admin / espaces authentifiés du tracking".
{{/callout}}
