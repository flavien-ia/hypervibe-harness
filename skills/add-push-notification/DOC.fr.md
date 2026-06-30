# /add-push-notification

Ajoute les notifications push : votre app peut prévenir ses utilisateurs sur leur téléphone, même fermée. C'est la notification « système », celle qui apparaît dans le centre de notifications de l'appareil, envoyée depuis votre serveur.

## Quand l'utiliser

- Vous voulez **prévenir vos utilisateurs** d'un événement (rappel de rendez-vous, nouveau message, commande expédiée) sans qu'ils aient l'app ouverte
- Vous voulez **ramener les utilisateurs** dans votre app au bon moment
- Vous avez déjà (ou acceptez d'installer) une PWA : c'est le prérequis technique

## Comment ça se passe

1. **Vérification de la PWA (prérequis indispensable)** : les notifications push reposent sur le "service worker" de la PWA, le composant qui reçoit et affiche les notifications même app fermée. **Sans PWA, le push est techniquement impossible.** Si votre app n'en est pas une, Hypervibe vous l'explique et vous propose de la transformer en PWA tout de suite (`/add-pwa`), puis enchaîne.

2. **Autres prérequis** : une base de données (`/add-db`) pour mémoriser quels appareils sont abonnés, et des comptes utilisateurs (`/add-auth`) pour savoir à qui appartient chaque appareil.

3. **Clés de signature (VAPID)** : Hypervibe génère la paire de clés qui prouve que c'est bien votre serveur qui envoie les notifications, et la range dans vos variables d'environnement (locales + Vercel).

4. **Table des abonnements** : chaque appareil qui accepte les notifications est enregistré en base, rattaché à son utilisateur.

5. **Extension du service worker** : réception de la notification, affichage, et ouverture de la bonne page de l'app au clic.

6. **Côté serveur** : un helper `sendPushToUser(db, userId, { title, body, url })` à appeler depuis n'importe où dans votre code pour notifier quelqu'un (tous ses appareils abonnés, avec nettoyage automatique des abonnements expirés).

7. **Côté utilisateur** : un bouton "Activer les notifications" (placé dans l'espace connecté) qui demande la permission et abonne l'appareil.

## Ce que ça crée pour vous

- Les clés VAPID dans vos variables d'environnement
- La table `push_subscription` en base
- Les handlers push dans le service worker
- Le helper serveur `~/server/push.ts` (`sendPushToUser`)
- Le router tRPC `push` (s'abonner, se désabonner, statut)
- Le composant `EnableNotifications` (le bouton d'activation)

## Prérequis

- **Une PWA** (`/add-pwa`) : proposée automatiquement si absente
- Une base de données (`/add-db`)
- Des comptes utilisateurs (`/add-auth` en mode users)

## Bon à savoir

- **iPhone/iPad** : le push web ne fonctionne que si l'utilisateur a **installé l'app sur son écran d'accueil** (iOS 16.4 minimum), et l'activation doit venir d'un geste de sa part (le bouton). C'est une règle d'Apple, pas une limite de votre app.
- Le push se teste **après déploiement** (le service worker est désactivé en développement).
- Complément naturel : `/add-notification-center` ajoute une cloche **dans l'app** avec l'historique des notifications. Les deux se combinent : un seul appel notifie alors la cloche **et** le téléphone.
