# /add-pwa

Transforme votre site en app installable (PWA) sur téléphone et ordinateur, sans passer par les stores. Vos visiteurs l'ajoutent à leur écran d'accueil et l'ouvrent en plein écran, comme une vraie application.

## Quand l'utiliser

- Vous voulez que vos utilisateurs puissent **installer votre app sur leur écran d'accueil** (icône, plein écran, sans barre d'adresse)
- Vous voulez une expérience plus "app native" (lancement rapide, page de secours hors-ligne)
- Vous préparez le terrain pour les **notifications push** (`/add-push-notification` exige une PWA)

## Comment ça se passe

1. **Vérification** : si la PWA est déjà en place, Hypervibe propose un menu (régénérer les icônes, changer le nom ou les couleurs, réinstaller des morceaux).

2. **Détection du projet** : Hypervibe vérifie que c'est un projet Next.js et que le favicon (`icon.svg`, créé par `/bootstrap`) est présent, car les icônes de l'app en dérivent.

3. **Installation de Serwist** : la bibliothèque qui gère le "service worker" (le composant invisible qui rend l'app installable et lui donne un cache hors-ligne).

4. **Manifest** : la carte d'identité de votre app (nom, couleurs, icônes, mode plein écran), générée à partir de votre projet (nom et palette détectés automatiquement).

5. **Icônes** : Hypervibe rasterise votre favicon en toutes les tailles nécessaires (Android, iOS, icône "maskable" avec zone de sécurité), aux couleurs de votre thème.

6. **Fenêtre d'invitation à l'installation** : une petite fenêtre s'affiche sur mobile pour inviter le visiteur à installer l'app. Sur Android, un bouton "Installer" déclenche l'installation native ; sur iPhone, elle explique pas à pas le geste "Partager puis Sur l'écran d'accueil" (Apple n'offre pas de bouton direct). Elle ne s'affiche ni sur ordinateur, ni si l'app est déjà installée, et sait se faire oublier 3 jours quand on la ferme.

7. **Vérification du code** : typage et lint avant de conclure.

## Ce que ça crée pour vous

- Le manifest de l'app (`src/app/manifest.ts`)
- Le service worker (`src/app/sw.ts`) avec un cache hors-ligne minimal
- Les icônes (`public/icons/`) : 192, 512, maskable, apple-touch
- Le composant `InstallPrompt` monté dans votre layout (la fenêtre d'invitation)
- Les réglages iOS (icône Apple, couleur de barre d'état)

## Prérequis

- Un projet Next.js (typiquement créé par `/bootstrap`)
- Rien d'autre : pas besoin de base de données ni de comptes utilisateurs

## Bon à savoir

- Le service worker est **désactivé en développement** (pour ne pas polluer votre cache pendant que vous codez) : l'installation et le mode hors-ligne se testent **après déploiement**, sur le site en ligne.
- La suite logique : `/add-push-notification` pour envoyer des notifications sur le téléphone de vos utilisateurs.
