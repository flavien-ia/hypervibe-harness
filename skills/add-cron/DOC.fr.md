# /add-cron

Ajoute une tâche qui s’exécute automatiquement à heure fixe dans votre projet. Idéal pour un envoi de newsletter chaque nuit, un nettoyage hebdomadaire, ou un rapport mensuel.

## Quand l’utiliser

- Envoyer une **newsletter quotidienne** à heure fixe
- **Nettoyer** la base de données la nuit (supprimer des fichiers temporaires, des sessions expirées…)
- **Synchroniser** vos données avec une API externe toutes les heures
- Générer un **rapport hebdomadaire** automatique

## Comment ça se passe

1. **Description de la tâche** : vous décrivez en une phrase ce que doit faire la tâche (ex: *"envoyer un rapport SEO hebdomadaire par email"*, *"réinitialiser les quotas utilisateur à minuit"*).

2. **Quand l’exécuter** : vous indiquez l’horaire en langage naturel (*"tous les jours à 9h"*, *"chaque lundi matin"*, *"toutes les heures"*). Hypervibe convertit en expression cron UTC.

3. **Nom court** : vous donnez un nom kebab-case pour la tâche (`rapport-hebdo`, `sync-clients`, `nettoyage`).

4. **Choix automatique de l’horloge** : Hypervibe décide elle-même quelle horloge utiliser (vous n’avez aucun choix à faire) :
  - **Votre horloge partagée** (le défaut, pour presque tout) : un mécanisme unique qui sert **tous** vos projets. Précise à la minute, et zéro coût supplémentaire quel que soit le nombre de tâches que vous ajoutez. C’est la même horloge qui gère déjà vos sauvegardes de base de données et votre surveillance de quotas.
  - **Cloudflare Worker dédié** (rare) : uniquement quand la tâche a besoin de ses propres ressources isolées chez Cloudflare (son espace R2, KV ou D1 à elle, ou un secret qui ne doit pas être partagé avec vos autres projets).
  - **GitHub Action** (secours) : utilisée seulement si Cloudflare n’est pas configuré sur votre ordi. Gratuit et illimité, mais avec **30-60 min de retard possible**.

5. **Configuration automatique** : Hypervibe met tout en place, l’endpoint protégé `/api/cron/<nom>` côté Next.js, la clé `CRON_SECRET` (générée si manquante), l’inscription de l’horaire sur l’horloge choisie (et les secrets GitHub si c’est l’horloge GitHub).

6. **Récap** : Hypervibe vous explique en une phrase **quelle horloge a été choisie et pourquoi** (par exemple : *"je l’ai mise sur votre horloge partagée : précise à la minute, elle sert tous vos projets sans coût supplémentaire"*).

7. **À vous de coder la logique** : la tâche est en place mais ne fait rien encore. Hypervibe a préparé le fichier où vous (ou Claude) écrirez ce qu’elle doit exécuter.

## Ce que ça crée pour vous

- Une **route protégée** `/api/cron/<nom>` côté Next.js (avec vérification du `CRON_SECRET`)
- La tâche **inscrite sur la bonne horloge** (votre horloge partagée par défaut ; Worker dédié ou GitHub Action quand c’est justifié)
- Sur l’horloge partagée : l’horaire enregistré dans un petit **registre versionné** sur votre ordi (chaque changement est tracé, vous pouvez toujours voir ce qui a changé et quand)
- La clé `CRON_SECRET` dans `.env` + Vercel
- Mise à jour de `CLAUDE.md` avec le récap de la tâche

## Prérequis

- Le projet doit être en Next.js déployé sur Vercel (typiquement par `/bootstrap`)
- Pour l’horloge partagée (et les Workers dédiés) : Cloudflare connecté à votre ordi (`/start` s’en occupe). Si Cloudflare n’est pas dispo, Hypervibe bascule automatiquement sur GitHub Action.

## Astuces

{{callout:tip|Vous pouvez piloter en langage naturel}}
Une fois la tâche en place, dites simplement à Hypervibe :
- *"lance la tâche tout de suite pour tester"*, déclenchement manuel
- *"montre-moi les derniers déclenchements"*, historique
- *"change l’horaire pour 10h"*, modification du cron
- *"supprime cette tâche"*, suppression complète

Vous n’avez **rien** à taper dans un terminal.
{{/callout}}

{{callout:info|Une seule horloge pour tout}}
En coulisses, tous vos projets partagent **une seule horloge** (un mécanisme Cloudflare mutualisé nommé `hypervibe-jobs`). Elle gère vos tâches planifiées, vos sauvegardes de base de données et votre surveillance de quotas, se réveille chaque minute, et ne consomme qu’une seule place cron Cloudflare au total, que vous ayez 1 tâche ou 50 réparties sur 10 projets. Sa liste d’horaires est versionnée (git) sur votre ordi : chaque modification laisse une trace. Une horloge dédiée n’est créée que si une tâche a vraiment besoin de ses propres ressources isolées.
{{/callout}}

{{callout:warning|Mauvais candidat pour /add-cron}}
Si votre besoin demande un **processus continu** (24h/7j), un **état persistant en mémoire** entre les exécutions, ou prend **plus de 60 secondes** par exécution, c’est `/add-automation` qu’il faut lancer à la place (pas `/add-cron`). Hypervibe détecte ce cas et vous redirige automatiquement.
{{/callout}}
