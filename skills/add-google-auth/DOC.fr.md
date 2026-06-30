# /add-google-auth

Active la **connexion via Google** sur votre app. Vos utilisateurs peuvent s'identifier avec un clic "Continuer avec Google".

## Quand l'utiliser

- Vous avez déjà mis en place l'authentification de base (`/add-auth` en mode utilisateurs) et vous voulez offrir à vos visiteurs une connexion plus rapide
- Vous voulez réduire la friction à l'inscription (un visiteur connecté à son compte Google peut créer un compte sur votre site en 1 clic)

## Comment ça se passe

1. **Vérification** : Hypervibe vérifie que NextAuth en mode utilisateurs est déjà en place. Si non, elle vous redirige vers `/add-auth`, pas de panique, vous reviendrez ici après.

2. **Création d'un projet Google Cloud** : Hypervibe vous guide pas-à-pas dans la console Google Cloud (console.cloud.google.com). Vous créez un nouveau projet (ou en sélectionnez un existant). C'est rapide.

3. **Écran de consentement OAuth** : vous remplissez les infos de votre app (nom, email de contact, scopes `email` et `profile`). Hypervibe vous donne le clic exact à faire à chaque étape.

4. **Création des identifiants OAuth** : vous créez un "Client OAuth 2.0" de type Application Web, avec les URLs de callback (locale + production) que Hypervibe vous fournit déjà toutes prêtes.

5. **Récupération des clés** : Google vous affiche un **Client ID** et un **Client Secret**. Vous les copiez-collez dans le chat.

6. **Configuration automatique** : Hypervibe pousse les deux clés dans `.env` local + Vercel (production + preview + development), ajoute le provider Google dans `src/server/auth.ts`, et met à jour `CLAUDE.md`.

7. **Vérification finale** : Hypervibe vous rappelle de tester en local (`pnpm dev` puis `/api/auth/signin`) et vous explique le statut "mode test" de Google.

## Ce que ça crée pour vous

- Un **projet Google Cloud** à votre nom, avec un écran de consentement et un client OAuth
- Les variables `AUTH_GOOGLE_ID` et `AUTH_GOOGLE_SECRET` dans `.env` local + Vercel
- Le provider Google ajouté à votre `src/server/auth.ts`
- Une mise à jour de `CLAUDE.md` (notamment : un rappel important si vous changez de domaine plus tard, il faudra ajouter la nouvelle URL côté Google)

## Prérequis

- `/add-auth` doit avoir été lancé en **mode utilisateurs** (le mode admin n'est pas compatible avec OAuth, il est conçu pour une seule personne, pas pour un système d'inscription).
- Un compte Google (gratuit). Vous l'avez probablement déjà si vous avez un Gmail.

## Astuces

{{callout:tip|Configurez votre domaine AVANT, idéalement}}
Si vous comptez utiliser un domaine personnalisé (`monsite.fr` au lieu de `monsite.vercel.app`), lancez `/add-domain` **avant** `/add-google-auth`. Sinon les URLs OAuth pointeront vers l'URL Vercel, et il faudra revenir dans Google Cloud Console plus tard pour **ajouter** (et pas remplacer, on garde aussi l'URL Vercel comme fallback de test) les URLs de votre vrai domaine.
{{/callout}}

{{callout:info|Mode test = max 100 utilisateurs}}
Par défaut, votre app Google est en "mode test" : seuls les utilisateurs de test ajoutés à l'étape 8 peuvent se connecter. C'est parfait pour le développement. Pour ouvrir l'accès à tout le monde, allez dans la console Google Cloud → API et services → Écran de consentement → "Publier l'application". Avec les scopes `email` et `profile` seulement, c'est immédiat (pas de validation Google requise).
{{/callout}}
