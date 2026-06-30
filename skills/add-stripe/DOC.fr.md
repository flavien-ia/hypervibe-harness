# /add-stripe

Ajoute les **paiements en ligne** à votre app via Stripe Checkout. Pour vendre des produits, accepter des dons, gérer des abonnements.

## Quand l'utiliser

- Vous voulez vendre quelque chose en ligne : une formation, un produit, une prestation, un abonnement mensuel/annuel
- Vous voulez accepter des dons ou des pré-commandes
- Vous voulez gérer un système d'achat unique ou récurrent

## Comment ça se passe

1. **Vérification** : si Stripe est déjà en place, Hypervibe vous propose un menu pour passer du mode test au mode live, régénérer les clés, mettre à jour le webhook secret, etc.

2. **Question produit** : Hypervibe vous demande **ce que vous voulez faire payer** :
  - Achat unique (formation, livre, prestation à l'unité…)
  - Abonnement récurrent (SaaS mensuel/annuel, accès membre…)
  - Mix des deux
  - Vous ne savez pas encore (l'infra est quand même posée, vous pourrez définir les produits plus tard)

3. **Installation** : Hypervibe installe le SDK Stripe (`stripe` + `@stripe/stripe-js`) et la CLI Stripe si nécessaire.

4. **Récupération des clés test** : Hypervibe vous explique la différence entre **mode test** (cartes bidon, aucun vrai paiement) et **mode live** (vrais paiements). Vous restez en test pour démarrer. Vous récupérez deux clés depuis dashboard.stripe.com/test/apikeys et vous les collez : `Publishable key` (`pk_test_...`) et `Secret key` (`sk_test_...`).

5. **Configuration automatique** : Hypervibe scaffold :
  - Un client Stripe serveur (`src/server/stripe.ts`)
  - Un webhook (`src/app/api/webhooks/stripe/route.ts`) qui vérifie la signature des messages venant de Stripe
  - Un router tRPC `payment` avec une procédure `createCheckoutSession`

6. **Capture automatique du webhook secret** : Hypervibe lance temporairement `stripe listen` pour capturer le `STRIPE_WEBHOOK_SECRET` (sans que vous ayez à le copier-coller), puis ferme l'écoute.

7. **CGV (optionnel)** : Hypervibe vous propose de générer vos Conditions Générales de Vente (obligatoires en France pour tout site qui vend). Elle vous pose des questions sur votre offre (type, prix, rétractation, remboursement, contact) et génère la page `/cgv` complète.

8. **Pages produits + checkout (optionnel)** : Hypervibe vous propose de construire les pages `/pricing`, `/payment/success`, `/payment/cancel` avec vos vrais produits, branchées sur Stripe.

## Ce que ça crée pour vous

- Les variables `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` (dans Vercel + `.env`)
- `STRIPE_WEBHOOK_SECRET` uniquement dans `.env` local (le webhook prod aura sa propre clé)
- Un client Stripe réutilisable dans tout votre code
- Un endpoint webhook sécurisé qui peut écouter les événements Stripe (paiement réussi, refund, etc.)
- Une procédure tRPC prête à l'emploi pour créer une session de checkout
- Optionnel : vos CGV générées
- Optionnel : vos pages produits + checkout

## Prérequis

- Le projet doit être en Next.js (typiquement initialisé par `/bootstrap`)
- Un compte Stripe (gratuit). La CLI Stripe sera installée par Hypervibe si manquante

## Astuces

{{callout:warning|Restez en mode TEST pour démarrer}}
**Ne passez pas en live tant que tout ne fonctionne pas en test.** Le mode test utilise des cartes bidon (`4242 4242 4242 4242`, n'importe quelle date future, n'importe quel CVC). Aucun vrai argent ne circule. C'est par là qu'on commence, toujours.
{{/callout}}

{{callout:tip|Pour tester en local}}
Quand vous testez des paiements en local (`pnpm dev`), ouvrez en parallèle un autre terminal et lancez :
```
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Sans ça, les webhooks de Stripe n'arrivent pas jusqu'à votre app locale et le checkout reste bloqué. Le `STRIPE_WEBHOOK_SECRET` dans `.env` est déjà configuré pour ce listener.
{{/callout}}

{{callout:info|Pour passer en live}}
Quand vous êtes prêt à encaisser de vrais paiements, dites simplement à Hypervibe : *"passe Stripe en live"*. Elle vous guide étape par étape (récupération des clés `pk_live_...` / `sk_live_...`, création du webhook production, push des clés sur Vercel, test avec un vrai paiement de 1€ que vous remboursez derrière). La procédure complète est aussi dans le `CLAUDE.md` de votre projet.
{{/callout}}
