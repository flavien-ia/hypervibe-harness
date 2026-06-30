# /add-agent

Crée un agent IA autonome qui tourne dans votre projet et décide tout seul des actions à mener. Idéal pour lire des emails, résumer des articles, surveiller un flux, ou tout workflow qui demande de la compréhension plutôt que des étapes prédéfinies.

## Quand l'utiliser

- Vous voulez un assistant qui lit vos emails support et propose des réponses en draft
- Vous voulez un agent qui agrège chaque matin les news de plusieurs flux RSS et vous envoie un brief
- Vous voulez surveiller une queue d'événements (commandes, alertes, signaux) et déclencher des actions intelligentes
- Vous voulez automatiser un workflow qui demande de la **compréhension** : lire un texte, le résumer, le classer, écrire une réponse personnalisée

**Pas adapté pour** : un chatbot temps-réel sur votre site (UI conversationnelle utilisateur), un cron simple sans IA, un traitement non-IA. Hypervibe vous redirige automatiquement vers la bonne commande si elle détecte un mismatch.

## Comment ça se passe

1. **Vérifications** : Hypervibe vérifie que vous avez une base de données (pour stocker l'historique de l'agent) et un envoi d'emails configuré (pour les notifications). Sinon, elle vous propose de lancer `/add-db` et/ou `/add-email` d'abord.

2. **Discovery (5 questions max, en français simple)** :
  - **Q1** : Quel est le but de l'agent ? (en une phrase, exemples concrets)
  - **Q2** : Quand l'agent doit-il s'exécuter ? (à heure fixe / en continu / à la demande). Si à heure fixe, on précise le rythme.
  - **Q3** : Doit-il **se souvenir** entre ses exécutions ? (mémoire clé-valeur simple, ou mémoire sémantique via vectorisation, ou aucune mémoire)
  - **Q4** : Quel modèle Claude ? (Sonnet par défaut, bon compromis prix/qualité ; Opus pour les tâches complexes ; Haiku pour les très répétitives)
  - **Q5** : Quel plafond de coût ? (par défaut : 5 USD/jour, 50 USD/mois, l'agent se met en pause s'il dépasse, et vous prévient par email)

3. **Vérification de la clé Anthropic** : Hypervibe regarde si vous avez une `ANTHROPIC_API_KEY` valide. Si non, elle vous guide pour la générer sur console.anthropic.com.

4. **Conversion en monorepo si nécessaire** : pour héberger l'agent à côté de votre Next.js, Hypervibe convertit votre projet en Turborepo (idempotent).

5. **Scaffolding** :
  - L'agent vit dans son propre dossier sous `apps/` (nommé d'après votre agent), déployable sur **Render** Background Worker
  - Boucle agentique propre (Anthropic SDK avec `cache_control` sur le system prompt et les tools)
  - Outils par défaut : `http-fetch` (lire des URLs), `send-email` (vous écrire), `db-query` (lire la DB en SELECT uniquement)
  - Plus d'autres outils selon le but : `analyze-rss`, `summarize-thread`, etc.
  - Si mémoire activée : tables `agent_memory_kv` (clé-valeur) ou `agent_memory_vector` (recherche sémantique via Cloudflare Workers AI)
  - **Circuit breaker** automatique : suit le coût en temps réel, met l'agent en pause si plafond dépassé, vous prévient par email
  - **Persistance complète** : chaque exécution + chaque tour de décision est sauvegardé dans des tables Postgres pour audit

6. **Déploiement sur Render** : Hypervibe génère `render.yaml`, commit, push. Vous validez côté dashboard Render (Blueprint creation, 1 manip qu'on ne peut pas automatiser).

7. **Dashboard optionnel** : Hypervibe vous propose ensuite d'ajouter `/admin/agents`, un dashboard pour suivre vos agents (`/add-agent-dashboard`).

## Ce que ça crée pour vous

- Un projet Turborepo si pas déjà (avec `apps/web/` + le dossier de votre agent sous `apps/`)
- Un agent IA complet : boucle agentique, outils, mémoire optionnelle, circuit breaker, persistance
- Tables Postgres : `agent_invocations`, `agent_turns`, `agent_memory_kv`, `agent_trigger_queue` (+ `agent_memory_vector` si mémoire sémantique)
- Variables d'environnement : `ANTHROPIC_API_KEY`, et selon le cas `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` pour les embeddings
- `render.yaml` pour le déploiement
- Le **stack diagram** mis à jour dans `CLAUDE.md`

## Prérequis

- Le projet doit être en Next.js (typiquement initialisé par `/bootstrap`)
- Base de données configurée (`/add-db`)
- Envoi d'emails configuré (`/add-email`), sinon l'agent ne peut pas vous alerter en cas de panne
- Un compte Anthropic (gratuit pour créer, payant à l'usage)
- Un compte Render (plan starter ~7$/mois pour le worker)

## Astuces

{{callout:warning|Le circuit breaker est votre meilleur ami}}
Par défaut, l'agent s'arrête automatiquement s'il dépasse **5 USD/jour ou 50 USD/mois**. C'est crucial : un agent qui boucle peut consommer rapidement. Vous recevez un email d'alerte, et vous pouvez décider de relever le plafond ou de creuser le bug. **Ne désactivez jamais le circuit breaker.**
{{/callout}}

{{callout:tip|Mémoire = facultative mais puissante}}
- **KV (clé-valeur)** : pour des données simples (préférences utilisateur, dernier ID traité, compteurs). Rapide, lookup direct.
- **Sémantique (vector)** : pour des connaissances en texte libre que l'agent peut chercher par sens (notes, articles, conversations). Plus coûteux mais bien plus puissant. Utilise Cloudflare Workers AI pour les embeddings (1024 dimensions, gratuit jusqu'à 10k req/jour).
- **Aucune mémoire** : l'agent repart à zéro à chaque exécution. Suffisant pour beaucoup de cas (digests quotidiens, etc.).
{{/callout}}

{{callout:info|Audit complet par défaut}}
Chaque exécution de l'agent est tracée dans la base : prompt initial, chaque tour de raisonnement (texte généré, outils utilisés, résultats), coût en USD, durée. Vous pouvez tout rejouer / revoir depuis le dashboard `/admin/agents` (skill `/add-agent-dashboard`). Indispensable pour comprendre ce que fait votre agent et le déboguer.
{{/callout}}
