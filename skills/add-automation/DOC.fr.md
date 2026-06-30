# /add-automation

Ajoute un traitement qui tourne en arrière-plan dans votre app. Tâche planifiée, processus long, webhook isolé, ou calcul intensif : Hypervibe analyse votre besoin et choisit elle-même la bonne infrastructure.

## Quand l'utiliser

- Vous avez un **process qui doit tourner en continu** (24h/7j), par exemple : surveiller une boîte mail, lire un flux RSS, écouter une queue de messages
- Vous avez un **traitement lourd** qui prend plus de 60 secondes (transcoding vidéo, génération PDF complexe, calcul intensif)
- Vous voulez **isoler un webhook** d'un service tiers (par ex. Slack) du reste de votre site
- Vous avez un **état persistant** à garder entre les exécutions (queue interne, cache mémoire)

Si votre besoin est plutôt une simple tâche périodique courte (< 60s, stateless), Hypervibe vous redirige vers `/add-cron`. Si c'est un **agent IA autonome**, elle vous bascule sur `/add-agent`.

## Comment ça se passe

1. **Discovery (1 question ouverte)** : Hypervibe vous demande de décrire votre besoin en quelques phrases, à quoi va servir le worker, à quel rythme il doit tourner, quelle est la nature du travail, et tout ce qui vous semble important.

2. **Clarifications ciblées** (max 3 questions, seulement si nécessaire) : Hypervibe analyse votre réponse selon 4 dimensions :
  - **Pattern** : event-driven, scheduled, ou continuous ?
  - **Charge** : légère ou lourde (CPU, RAM, gros fichiers, IA générative) ?
  - **Fréquence** (si scheduled) : quotidienne, horaire, sub-minute, irrégulière ?
  - **État persistant** : stateless ou stateful ?
   
   Si tout est clair après votre première description, Hypervibe ne pose aucune question et passe directement au choix de l'infra.

3. **Détection agent IA** : si votre description mentionne *analyser, comprendre, résumer, décider, juger, rédiger*, ou explicitement *agent IA, LLM, Claude*, Hypervibe vous propose de basculer sur `/add-agent` (qui pose les bonnes questions IA et scaffold proprement avec circuit breaker, tracking de coût, etc.).

4. **Décision automatique de l'infrastructure** :
  - **Tâche simple périodique** → délègue à `/add-cron`
  - **Worker léger / scheduled / event-driven** → **Cloudflare Worker** (rapide à déployer, scale auto, gratuit jusqu'à 100k requêtes/jour)
  - **Process lourd / continu 24h-7j / état persistant** → **Render Background Worker** (peut tourner indéfiniment, vraies ressources serveur, ~7$/mois sur le plan starter)

5. **Conversion en monorepo si nécessaire** : pour héberger le worker à côté de votre Next.js, Hypervibe convertit votre projet en Turborepo (idempotent, pas de risque si déjà monorepo). Votre code Next.js se retrouve dans `apps/web/`, le worker dans `apps/worker/`.

6. **Scaffolding du worker** : selon le choix, Hypervibe :
  - **Cloudflare Worker** : crée `apps/worker/` avec wrangler.toml, deploys auto via wrangler
  - **Render Worker** : crée `apps/worker/` avec un template TypeScript long-running, génère le `render.yaml` à la racine, commit et push. Vous validez ensuite côté dashboard Render (Blueprint creation, 1 manip).

7. **Logique métier** : la coquille est en place. Hypervibe vous propose ensuite d'écrire la logique métier dans le worker selon votre description.

## Ce que ça crée pour vous

- Si conversion nécessaire : votre projet est devenu un **monorepo Turborepo** (avec `apps/web/` pour le Next.js, `apps/worker/` pour le worker)
- Un **worker scaffoldé** prêt à recevoir votre logique métier
- Selon le cas : déployé automatiquement (Cloudflare) ou prêt à être ajouté manuellement à Render (1 dernière manip côté dashboard)
- Mise à jour de `CLAUDE.md` avec la description du worker

## Prérequis

- Le projet doit être en Next.js (typiquement initialisé par `/bootstrap`)
- Pour Cloudflare Worker : Cloudflare connecté (`/start` s'en occupe)
- Pour Render Worker : un compte Render (gratuit pour commencer, mais le plan starter pour worker = ~7$/mois)

## Astuces

{{callout:info|3 chemins, 1 commande}}
`/add-automation` est un **orchestrateur** : selon votre besoin, elle vous redirige vers la bonne commande spécialisée (`/add-cron`, `/add-agent`) ou scaffold directement un worker (Cloudflare ou Render). Vous n'avez pas à choisir vous-même, vous décrivez, Hypervibe décide.
{{/callout}}

{{callout:warning|Render = payant après le worker}}
Render offre un plan gratuit pour les services web simples, mais pour les **Background Workers** (process qui tournent 24h/7j), il faut le plan starter (~7$/mois). Si votre besoin ne demande pas vraiment du 24h/7j, Hypervibe préférera Cloudflare Worker (gratuit) ou `/add-cron` (gratuit aussi).
{{/callout}}

{{callout:tip|Agent IA = commande dédiée}}
Si votre worker doit "comprendre / décider / résumer / rédiger" (un agent IA autonome), Hypervibe vous bascule sur `/add-agent` qui est conçu pour ça : modèle Claude, mémoire entre exécutions, plafond budgétaire (par défaut 5 USD/jour, 50 USD/mois), persistance de chaque décision pour audit. Vous gardez exactement le même point d'entrée (`/add-automation`), Hypervibe route automatiquement.
{{/callout}}
