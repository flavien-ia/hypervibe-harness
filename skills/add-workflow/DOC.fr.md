# /add-workflow

Ajoute un workflow intelligent à votre app : quand un événement se produit, elle enchaîne plusieurs étapes, dont certaines font appel à l'IA (lire, classer, extraire, rédiger), puis s'arrête. Tout tourne **dans votre app**, sans serveur dédié, sans agent à déployer, sans infrastructure en plus.

## Quand l'utiliser

- **Un client dépose un document** → l'analyser, en extraire les infos, prévenir la bonne personne
- **Un formulaire est soumis** → enrichir via deux services externes, rédiger une synthèse, l'enregistrer
- **Un paiement arrive** → générer la facture, l'envoyer, mettre le dossier à jour
- **Un email entre** → le classer, préparer un brouillon de réponse, le ranger

Le point commun : une **séquence finie** (2 à 8 étapes connues d'avance), déclenchée par un événement, qui se termine en quelques secondes. C'est ce que beaucoup de gens appellent « un agent »... alors qu'aucun agent n'est nécessaire.

## Comment ça se passe

1. **Vous décrivez la chaîne** : l'événement déclencheur, les étapes dans l'ordre, le résultat attendu. Hypervibe repère seule les étapes qui demandent de l'intelligence.

2. **Le garde-fou de durée** : Hypervibe estime le temps total et le compare à ce que votre hébergement autorise pour un traitement d'un seul tenant. En dessous de la minute, c'est toujours bon ; quelques minutes se configurent ; au-delà, elle vous propose honnêtement la version découpée (l'événement enregistre la demande, un rendez-vous planifié traite la file) ou vous réoriente vers `/add-automation`.

3. **Mise en place** : Hypervibe crée le moteur de workflow du projet (une seule fois), votre workflow avec ses étapes typées, et le déclencheur choisi : une action dans l'app, une adresse sécurisée pour un service externe (webhook), ou un horaire via `/add-cron`.

4. **Chaque exécution est tracée** : étape par étape, avec les durées et les erreurs, dans une table de votre base. Vous pouvez demander à tout moment : *« montre-moi les dernières exécutions »*.

5. **La vraie logique, maintenant ou plus tard** : comme toujours, vous décrivez et Hypervibe implémente, ou vous gardez le squelette d'exemple et y revenez quand vous voulez.

## Ce que ça crée pour vous

- Le **moteur de workflows** du projet (`src/server/workflows/`), partagé par tous vos futurs workflows
- **Votre workflow**, avec ses étapes (relance automatique sur les appels réseau qui échouent)
- Le **déclencheur** : action dans l'app, webhook sécurisé, ou tâche planifiée
- La **table de traçage** `workflow_run` dans votre base (chaque exécution, chaque étape, chaque durée)
- La clé Claude (`ANTHROPIC_API_KEY`) configurée si vos étapes intelligentes en ont besoin
- Mise à jour de `CLAUDE.md` avec le récap du workflow

## Prérequis

- Un projet Next.js déployé sur Vercel (typiquement par `/bootstrap`)
- Pour les étapes intelligentes : une clé API Claude (Hypervibe vous guide pour la créer, c'est l'affaire de 2 minutes ; chaque exécution coûte alors quelques centimes au plus, selon la taille des contenus)
- Une base de données (`/add-db`) pour le traçage ; sans elle, le workflow fonctionne quand même, tracé dans les journaux

## Astuces

{{callout:tip|« Je veux un agent » ? Souvent, vous voulez ceci}}
Un agent, c'est une IA qui décide elle-même de ses prochaines actions, en boucle, avec des outils. C'est puissant, et rarement nécessaire. Si votre besoin se décrit comme « quand X arrive, fais A puis B puis C », c'est un workflow : plus simple, moins cher, sans infrastructure, et chaque exécution est traçable étape par étape. En cas de doute, lancez `/add-automation` : elle analyse votre besoin et choisit pour vous.
{{/callout}}

{{callout:info|Les doublons sont neutralisés}}
Les services externes renvoient parfois deux fois le même événement (c'est normal chez eux). Chaque exécution porte une clé d'identité : si le même événement revient, le workflow le reconnaît et ne refait rien. Vos clients ne recevront pas deux factures.
{{/callout}}

{{callout:warning|Mauvais candidats}}
Un traitement **continu** (surveiller une boîte mail 24h/24), un **état à garder en mémoire** entre les exécutions, ou des **minutes de calcul intensif** : c'est le territoire de `/add-automation` (worker dédié). Une IA **au service direct de vos utilisateurs**, en boucle autonome : `/add-agent`. Une mission récurrente **pour vous-même** : `/add-routine`.
{{/callout}}
