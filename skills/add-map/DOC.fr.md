# /add-map

Ajoute une **carte interactive** à votre site (page contact, liste d'agences, événements, ou app entièrement basée sur une carte). Gratuit, sans clé API à gérer, RGPD-friendly.

## Quand l'utiliser

- Vous voulez afficher **votre adresse pro** sur la page contact
- Vous avez **plusieurs lieux** à montrer (agences, boutiques, écoles, événements)
- Vous construisez une **app map-first** (annuaire géolocalisé, locator de services)
- Vous voulez tracer un **itinéraire** ou une **zone**

## Comment ça se passe

1. **Une question** : Hypervibe vous demande ce que vous voulez faire avec la carte. À partir de votre réponse, elle infère tout le reste (combien de points, sur quelle page, statique ou interactif).
2. **Vous donnez les emplacements** : soit l'adresse postale (Hypervibe la géocode automatiquement via OpenStreetMap), soit directement les coordonnées GPS si vous les avez.
3. **Hypervibe installe les briques techniques** : la bibliothèque de cartes (MapLibre GL JS), les composants React, et la connexion au service de tuiles (OpenFreeMap : gratuit, sans clé).
4. **Hypervibe câble la carte sur la bonne page** : selon votre cas d'usage, c'est intégré à votre page contact, à une nouvelle page dédiée (`/agences`, `/locations`...), ou en plein écran sur la home.
5. **Fallback texte pour le SEO** : sous chaque carte, Hypervibe ajoute automatiquement la liste textuelle des points avec un lien Google Maps. Comme ça, Google indexe les adresses et les lecteurs d'écran y ont accès.
6. **Mise à jour de la politique de confidentialité** : OpenFreeMap est ajouté comme sous-traitant (il voit l'IP du visiteur quand il charge les tuiles : pas de cookie, infra en Europe).

## Ce que ça crée pour vous

- Un **composant carte** (`src/components/site/map.tsx`) déjà stylisé, prêt à recevoir des points
- Un **wrapper sécurisé** (`map-loader.tsx`) qui empêche les bugs de rendu côté serveur
- **Vos points** soit en dur dans le code (1-3 lieux), soit dans un fichier de données (`src/lib/locations.ts`, 4-30 lieux), soit dans une table de base de données (plus de 30 lieux ou besoin d'un admin pour les modifier)
- La **carte affichée sur la page choisie** avec popup au clic d'un point
- Le **fallback HTML** sous la carte pour le SEO et l'accessibilité
- Une **entrée OpenFreeMap** dans votre politique de confidentialité

## Prérequis

- Le projet doit être en Next.js (typiquement initialisé par `/bootstrap`)
- Vos adresses ou coordonnées GPS
- C'est tout : **pas de carte bancaire à donner, pas de clé API à créer, pas d'inscription**

## Astuces

{{callout:tip|Pourquoi OpenFreeMap et pas Google Maps ?}}
Google Maps demande une carte bancaire (même si le free tier couvre la plupart des cas), une clé API à gérer, et envoie des données aux États-Unis. OpenFreeMap est un projet open source européen, gratuit sans condition, sans clé, sans cookie. Les **mêmes données** OpenStreetMap (cartes, rues, commerces) sans la complexité.
{{/callout}}

{{callout:info|Cinq styles disponibles}}
Liberty (défaut, équilibré), Positron (clair et minimaliste), Bright (couleurs vives), Dark (mode sombre), Fiord 3D (relief 3D). Pour changer : éditez la constante `TILE_STYLE_URL` en haut de `src/components/site/map.tsx`. Aucune autre modification nécessaire.
{{/callout}}

{{callout:tip|Plusieurs centaines de points ?}}
Si vous avez beaucoup de points sur une zone restreinte (genre boutiques d'une ville), demandez à Claude *"ajoute du clustering sur la carte"* après l'install. MapLibre supporte nativement le regroupement automatique des points proches en clusters cliquables.
{{/callout}}

{{callout:warning|Geocoding au runtime}}
Si vos utilisateurs entrent des adresses libres dans un formulaire et que vous voulez les afficher sur la carte automatiquement, ça demande un service de geocoding payant (Mapbox / MapTiler) : OpenStreetMap Nominatim limite trop strictement pour ça. Hypervibe utilise Nominatim **uniquement à l'installation** pour vos points fixes, pas en production.
{{/callout}}
