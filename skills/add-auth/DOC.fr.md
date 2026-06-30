# /add-auth

Ajoute la **connexion / inscription** à votre app. Une seule question vous décide entre deux modes : un login admin réservé à vous, ou un système complet de comptes utilisateurs.

## Quand l'utiliser

- Vous voulez un espace privé sur votre site que seul vous (ou une petite équipe) peut voir
- Votre app a des utilisateurs qui doivent créer un compte, se connecter, avoir leur propre espace
- Vous voulez ajouter la connexion via Google ou GitHub (vous lancerez `/add-auth` d'abord, puis `/add-google-auth` ou `/add-github-auth`)

## Comment ça se passe

1. **Vérification** : Hypervibe détecte si une authentification est déjà en place sur le projet. Si oui, vous avez un petit menu pour la faire évoluer (ajouter Google, changer le mot de passe admin, ajouter "mot de passe oublié", etc.).

2. **Question principale** (sauf si déjà choisi par `/bootstrap`) : Hypervibe vous demande quel type d'authentification vous voulez :
  - **Mode admin** : un seul login fixe (le vôtre), avec un mot de passe stocké dans les variables d'environnement. Parfait pour un backoffice, un tableau de bord privé, une admin de site.
  - **Mode utilisateurs** : un vrai système avec inscription, connexion, page de compte, suppression de compte. Adapté quand vous avez des utilisateurs externes qui ont besoin de leur propre espace.

3. **Mise en place automatique** :
  - **Mode admin** : Hypervibe génère un mot de passe sécurisé, le hash, le pousse dans vos variables Vercel + locales. Le mot de passe en clair vous est affiché **une seule fois** : à sauvegarder dans votre gestionnaire de mots de passe.
  - **Mode utilisateurs** : Hypervibe ajoute les tables nécessaires en base de données (utilisateurs, sessions, comptes, vérifications), crée les pages `/signin` / `/signup` / `/account`, l'API tRPC pour l'inscription/connexion, et l'intégration NextAuth complète.

4. **Suite optionnelle** : Hypervibe vous propose ensuite d'ajouter Google ou GitHub OAuth en complément (jamais en remplacement, l'email/mot de passe reste le socle).

## Ce que ça crée pour vous

**En mode admin** :
- Un fichier `src/server/auth.ts` qui gère un login fixe
- Les variables `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH_DEV`, `ADMIN_PASSWORD_HASH_PROD` dans `.env` + Vercel
- Une fonction `isAdmin()` que vous pouvez utiliser pour protéger des pages
- Mot de passe affiché une fois pour vous

**En mode utilisateurs** :
- Toutes les tables NextAuth en base de données (users, sessions, accounts, verification_tokens, password_reset_tokens)
- Pages `/signin`, `/signup`, `/account`, et optionnellement `/forgot-password` + `/reset-password`
- API tRPC pour l'inscription et la connexion sécurisées (hashing scrypt, rate limiting, protection anti-brute force)
- Layout du site mis à jour avec un menu utilisateur (connexion/déconnexion)

## Prérequis

- Le projet doit être en Next.js
- Mode utilisateurs : nécessite une base de données, `/add-db` doit avoir été lancé d'abord (Hypervibe vous le propose si manquant)
- Mode utilisateurs avec mot de passe oublié : nécessite aussi `/add-email` configuré

## Astuces

{{callout:tip|Vous pouvez avoir les deux modes en même temps}}
Si vous avez déjà choisi un mode et que vous voulez ajouter l'autre plus tard, relancez `/add-auth` : un menu vous propose d'ajouter le second mode sans casser l'existant. Le login admin et la signup utilisateurs peuvent coexister.
{{/callout}}

{{callout:warning|Le mot de passe admin n'est affiché qu'une seule fois}}
En mode admin, le mot de passe en clair vous est montré **une seule fois** à la fin de la mise en place. Sauvegardez-le dans votre gestionnaire de mots de passe immédiatement, il n'est stocké nulle part en clair sur disque (seul le hash existe).
{{/callout}}
