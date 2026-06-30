# /add-2fa

Ajoute la **double authentification** au login de votre app : un code à 6 chiffres depuis une appli d'authentification (Google Authenticator, Authy, 1Password...) en plus du mot de passe, un vrai gain de sécurité contre les mots de passe volés.

## Quand l'utiliser

- Votre app a un login (un espace admin ou des comptes utilisateurs) et vous voulez le renforcer.
- Vous manipulez des données sensibles (clients, commandes, paiements) et voulez une seconde couche au-delà du mot de passe.
- Un client, ou votre propre politique de sécurité, exige une authentification forte.

## Comment ça se passe

1. **Choix de l'appli** : Hypervibe demande quelle appli d'authentification vous (ou vos utilisateurs) allez utiliser.

2. **Détection de l'authentification** : il détecte comment votre projet gère le login et s'adapte :
  - **Espace admin** (un login unique fixe) : la 2FA est rendue **obligatoire** pour cet admin. La clé secrète et les codes de secours sont rangés en sécurité dans votre coffre-fort de mots de passe, jamais affichés dans le chat.
  - **Comptes utilisateurs** : la 2FA devient **optionnelle pour chaque utilisateur**, et chacun l'active depuis sa propre page de compte. La clé et les codes de secours de chaque personne vivent dans la base de données, liés à son compte.

3. **Installation** : Hypervibe met tout en place : la génération des codes, le parcours de connexion avec l'étape supplémentaire, une option « appareil de confiance » pour ne pas redemander le code à chaque visite, et une déconnexion automatique après inactivité. Il prépare aussi le QR code (ou la clé) pour enrôler votre appli.

4. **Codes de secours** : un jeu de codes de secours à usage unique est généré au cas où vous perdriez votre téléphone. Ils sont rangés en sécurité (coffre ou compte), jamais affichés en clair dans le chat.

> **Prérequis** : votre projet doit déjà avoir un login. S'il n'en a pas, Hypervibe propose d'en installer un d'abord, puis ajoute la 2FA juste après.
