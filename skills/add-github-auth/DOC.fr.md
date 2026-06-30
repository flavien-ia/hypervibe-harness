# /add-github-auth

Active la **connexion via GitHub** sur votre app. Vos utilisateurs peuvent s'identifier avec un clic "Continuer avec GitHub".

## Quand l'utiliser

- Votre app cible des développeurs ou des profils tech qui ont déjà un compte GitHub
- Vous voulez une connexion en un clic en complément de l'email/mot de passe
- Vous avez déjà lancé `/add-auth` en mode utilisateurs

## Comment ça se passe

1. **Vérification** : Hypervibe vérifie que NextAuth en mode utilisateurs est déjà en place. Si non, elle vous redirige vers `/add-auth`.

2. **Création d'une OAuth App sur GitHub** : Hypervibe vous guide dans les paramètres développeur de GitHub (github.com/settings/developers → OAuth Apps → New OAuth App).

3. **Remplissage du formulaire** : nom de votre app, URL de production, URL de callback. Hypervibe vous donne les valeurs exactes à coller.

4. **Récupération des identifiants** : GitHub affiche le **Client ID** directement sur la page. Vous cliquez ensuite sur "Generate a new client secret" pour obtenir le **Client Secret** (à copier immédiatement, GitHub ne le montre qu'une fois).

5. **Configuration automatique** : Hypervibe pousse les deux clés dans `.env` local + Vercel, ajoute le provider GitHub dans `src/server/auth.ts`, et met à jour `CLAUDE.md`.

6. **Ajustement final de l'URL de callback** : GitHub n'accepte qu'**une seule** URL de callback par OAuth App. Hypervibe vous propose deux options pour gérer dev + prod : soit créer une 2e OAuth App dédiée au dev (recommandé), soit alterner l'URL selon le contexte.

## Ce que ça crée pour vous

- Une **OAuth App** GitHub à votre nom
- Les variables `AUTH_GITHUB_ID` et `AUTH_GITHUB_SECRET` dans `.env` local + Vercel
- Le provider GitHub ajouté à votre `src/server/auth.ts`
- Une mise à jour de `CLAUDE.md`

## Prérequis

- `/add-auth` doit avoir été lancé en **mode utilisateurs** (le mode admin n'est pas compatible avec OAuth).
- Un compte GitHub (gratuit, vous en avez forcément un puisque votre code y est déjà stocké).

## Astuces

{{callout:warning|Une seule URL de callback par OAuth App}}
GitHub ne supporte qu'**une** URL de callback par OAuth App, contrairement à Google qui en accepte plusieurs. Pour utiliser GitHub OAuth en local ET en production sans conflit :
- **Recommandé** : créer **deux OAuth Apps** distinctes (une pour `localhost:3000`, une pour votre URL de prod). Vous gardez les identifiants de la prod dans Vercel et ceux du dev dans `.env` local.
- **Alternative** : alterner l'URL dans les paramètres GitHub selon que vous testez en local ou que vous déployez. Plus simple mais moins pratique.
{{/callout}}

{{callout:info|Pas de mode test chez GitHub}}
Contrairement à Google, GitHub OAuth n'a pas de "mode test" avec une whitelist d'utilisateurs. Dès que votre OAuth App est créée, **n'importe quel utilisateur GitHub peut s'y connecter**. Si vous voulez restreindre l'accès (par exemple à votre équipe). Vous devrez gérer ça côté code (whitelist d'emails, rôles, etc.).
{{/callout}}
