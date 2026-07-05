# /add-automation

Ajoute une automatisation : un traitement qui tourne en arrière-plan pour votre app, ou une mission récurrente pour vous-même. Tâche planifiée, processus long, webhook isolé, calcul intensif, ou brief IA personnel : Hypervibe analyse votre besoin et choisit elle-même la bonne maison.

## Quand l’utiliser

- Vous avez un **process qui doit tourner en continu** (24h/7j), par exemple : surveiller une boîte mail, lire un flux RSS, écouter une queue de messages
- Vous avez un **traitement lourd** qui prend plus de 60 secondes (transcoding vidéo, génération PDF complexe, calcul intensif)
- Vous voulez **isoler un webhook** d’un service tiers (par ex. Slack) du reste de votre site
- Vous avez un **état persistant** à garder entre les exécutions (queue interne, cache mémoire)
- Vous voulez une **mission récurrente pour vous-même** : un brief du matin, une analyse hebdo, une veille qui vous alerte

Si votre besoin est une simple tâche périodique courte (< 60s, stateless), Hypervibe vous redirige vers `/add-cron`. Si c’est un **agent IA qui fait partie de votre produit**, elle vous bascule sur `/add-agent`.

## Comment ça se passe

1. **Discovery (1 question ouverte)** : Hypervibe vous demande de décrire votre besoin en quelques phrases : ce que fera cette automatisation, à quel rythme elle doit tourner, et tout ce qui vous semble important.

2. **Première inférence : pour qui ?** Avant tout choix technique, Hypervibe détermine à qui profite le résultat :
  - **Votre app ou ses utilisateurs** (nettoyer la base, écrire aux clients, synchroniser des données affichées) → le job part sur l’**infrastructure de l’app**, pour continuer de tourner quoi qu’il arrive à vos outils personnels.
  - **Vous** (un brief, une analyse, une veille, un rapport pour vos propres yeux) → si le travail demande de l’IA (lire, juger, rédiger), il devient une **routine Claude** : une mission récurrente que votre propre Claude exécute pour vous. Zéro infrastructure, zéro code dans le projet.
   
   Hypervibe le déduit de votre formulation et ne pose la question que si c’est vraiment ambigu (*"un rapport hebdomadaire"*, pour qui ?).

3. **Clarifications ciblées** (max 3 questions, seulement si nécessaire) : Hypervibe analyse votre réponse selon ces dimensions :
  - **Pattern** : event-driven, scheduled, ou continuous ?
  - **Charge** : légère ou lourde (CPU, RAM, gros fichiers, IA générative) ?
  - **Fréquence** (si scheduled) : quotidienne, horaire, sub-minute, irrégulière ?
  - **État persistant** : stateless ou stateful ?
   
   Si tout est clair après votre première description, Hypervibe ne pose aucune question et passe directement à la recommandation.

4. **Décision automatique** :
  - **Mission IA récurrente pour vous** → **routine Claude** (votre propre Claude l’exécute au bon moment ; aucune infrastructure)
  - **Tâche périodique simple pour l’app** → délègue à `/add-cron` (qui l’inscrit par défaut sur votre horloge partagée)
  - **Worker léger / event-driven / précision sous la minute** → **Cloudflare Worker** (rapide à déployer, scale auto, gratuit jusqu’à 100k requêtes/jour)
  - **Process lourd / continu 24h-7j / état persistant** → **Render Background Worker** (peut tourner indéfiniment, vraies ressources serveur, ~7$/mois sur le plan starter)
  - **IA au service des utilisateurs de votre app** → passe la main à `/add-agent` (agent de production avec plafonds de budget et traçabilité complète)

5. **Conversion en monorepo si nécessaire** (workers uniquement) : pour héberger le worker à côté de votre Next.js, Hypervibe convertit votre projet en Turborepo (idempotent, pas de risque si déjà monorepo). Votre code Next.js se retrouve dans `apps/web/`, le worker dans `apps/worker/`.

6. **Mise en place** : selon le choix, Hypervibe :
  - **Routine Claude** : rédige la mission avec vous (objectif, étapes, livrable), vous la validez, et la routine est créée sur votre compte Claude. Selon votre installation, elle tourne dans le cloud (même ordinateur éteint) ou sur cet ordinateur quand l’app Claude est ouverte.
  - **Cloudflare Worker** : crée `apps/worker/` avec wrangler.toml, déploie automatiquement via wrangler
  - **Render Worker** : crée `apps/worker/` avec un template TypeScript long-running, génère le `render.yaml` à la racine, commit et push. Vous validez ensuite côté dashboard Render (Blueprint creation, 1 manip).

7. **Logique métier** (workers uniquement) : la coquille est en place. Hypervibe vous propose ensuite d’écrire la logique métier dans le worker selon votre description. (Une routine n’a pas de coquille : la mission que vous avez validée EST la logique.)

## Ce que ça crée pour vous

- **Si routine** : une mission récurrente sur votre propre compte Claude, plus une note dans `CLAUDE.md`. Aucun code, aucune infrastructure, aucun monorepo.
- Si conversion nécessaire : votre projet est devenu un **monorepo Turborepo** (avec `apps/web/` pour le Next.js, `apps/worker/` pour le worker)
- Un **worker scaffoldé** prêt à recevoir votre logique métier
- Selon le cas : déployé automatiquement (Cloudflare) ou prêt à être ajouté manuellement à Render (1 dernière manip côté dashboard)
- Mise à jour de `CLAUDE.md` avec la description de ce qui a été mis en place

## Prérequis

- Le projet doit être en Next.js (typiquement initialisé par `/bootstrap`)
- Pour Cloudflare Worker : Cloudflare connecté (`/start` s’en occupe)
- Pour Render Worker : un compte Render (gratuit pour commencer, mais le plan starter pour worker = ~7$/mois)
- Pour une routine Claude : rien d’autre que votre abonnement Claude (la routine tourne sur votre propre compte)

## Astuces

{{callout:info|Votre app ou vous ? La seule frontière qui compte}}
Un job qui sert **votre app** part sur l’infrastructure de l’app : il doit continuer de tourner même si vous changez d’outils ou résiliez des abonnements. Un job qui sert **vous** peut devenir une **routine** : votre propre Claude l’exécute, sans aucune infrastructure. Deux choses honnêtes sur les routines : chaque exécution consomme un peu de votre abonnement Claude, et si votre abonnement s’arrête, la routine s’arrête avec. C’est exactement pour ça que rien de ce dont votre app dépend ne va JAMAIS sur une routine. Bon à savoir aussi : cadence minimum 1 heure ; les routines cloud tournent même ordinateur éteint, les locales tournent quand l’app Claude est ouverte.
{{/callout}}

{{callout:info|4 chemins, 1 commande}}
`/add-automation` est un **orchestrateur** : selon votre besoin, elle vous redirige vers la bonne commande spécialisée (`/add-cron`, `/add-agent`), scaffold un worker (Cloudflare ou Render), ou met en place une routine Claude. Vous n’avez pas à choisir vous-même : vous décrivez, Hypervibe décide et vous explique pourquoi.
{{/callout}}

{{callout:warning|Render = payant pour le worker}}
Render offre un plan gratuit pour les services web simples, mais pour les **Background Workers** (process qui tournent 24h/7j), il faut le plan starter (~7$/mois). Si votre besoin ne demande pas vraiment du 24h/7j, Hypervibe préférera Cloudflare Worker (gratuit), `/add-cron` (gratuit aussi), ou une routine (aucune infrastructure du tout).
{{/callout}}

{{callout:tip|IA pour votre produit = commande dédiée}}
Si l’IA sert **les utilisateurs de votre app** (classer LEURS tickets, personnaliser LEURS emails, traiter LEURS documents), Hypervibe vous bascule sur `/add-agent`, conçu pour ça : modèle Claude, mémoire entre exécutions, plafond budgétaire (par défaut 5 USD/jour, 50 USD/mois), persistance de chaque décision pour audit. Si l’IA travaille **pour vous** (brief, veille, analyse), une routine fait le travail sans toute cette machinerie. Le point d’entrée reste le même : `/add-automation` route automatiquement.
{{/callout}}
