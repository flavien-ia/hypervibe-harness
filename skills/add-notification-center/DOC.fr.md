# /add-notification-center

Ajoute une cloche de notifications dans votre app, avec pastille de non-lues et historique consultable. Le panneau liste les notifications de l'utilisateur ; cliquer ouvre la page concernée et marque comme lu.

## Quand l'utiliser

- Vous voulez que vos utilisateurs **retrouvent leurs notifications dans l'app** (historique consultable, lu/non-lu)
- Vous voulez la classique **cloche avec compteur** en haut de l'interface
- Avec ou sans notifications push : le centre fonctionne seul

## La différence avec /add-push-notification

- **Le push** envoie une notification **système**, sur le téléphone, même app fermée : il attire l'attention, puis disparaît.
- **Le centre in-app** garde chaque notification **dans l'app** : l'utilisateur peut les consulter quand il veut, voir ce qui est nouveau, marquer comme lu.

Les deux se complètent et s'installent **dans n'importe quel ordre** : dès que les deux sont là, un seul appel (`notifyUser`) sonne la cloche **et** pousse sur le téléphone.

## Comment ça se passe

1. **Vérification** : si le centre est déjà en place, Hypervibe propose un menu (réinstaller la cloche, régénérer, re-câbler le push).

2. **Prérequis** : une base de données (`/add-db`) pour stocker les notifications, et des comptes utilisateurs (`/add-auth`) pour savoir à qui chaque notification appartient.

3. **Table des notifications** : titre, message, lien, état lu/non-lu, date.

4. **Helper serveur `notifyUser`** : le point d'entrée unique pour notifier quelqu'un depuis votre code. Il enregistre la notification (pour la cloche) et, si les notifications push sont installées, en envoie aussi une sur le téléphone.

5. **API** : lister les notifications, compter les non-lues, marquer comme lu (une ou toutes).

6. **La cloche** : composant prêt à l'emploi, posé dans votre header. Pastille rouge avec le compteur, panneau déroulant, mise à jour instantanée à chaque action (et rafraîchissement du compteur en arrière-plan toutes les 30 secondes).

7. **Vérification du code** : typage et lint avant de conclure.

## Ce que ça crée pour vous

- La table `notification` en base
- Le helper serveur `~/server/notify.ts` (`notifyUser(db, userId, { title, body, url })`)
- Le router tRPC `notifications` (liste, compteur, marquage lu)
- Le composant `NotificationBell` monté dans votre header

## Prérequis

- Une base de données (`/add-db`)
- Des comptes utilisateurs (`/add-auth` en mode users)
- Pas besoin de PWA ni de push : le centre est autonome

## Bon à savoir

- Pour créer une notification depuis votre code serveur : `await notifyUser(db, userId, { title: "Commande expédiée", body: "Votre colis arrive jeudi.", url: "/commandes" })`.
- Si vous ajoutez `/add-push-notification` plus tard, le câblage se fait automatiquement : `notifyUser` se mettra à envoyer aussi la notification système, sans rien changer à votre code.
