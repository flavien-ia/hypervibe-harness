# /add-cron

Ajoute une tâche qui s'exécute automatiquement à heure fixe dans votre projet. Idéal pour un envoi de newsletter chaque nuit, un nettoyage hebdomadaire, ou un rapport mensuel.

## Quand l'utiliser

- Envoyer une **newsletter quotidienne** à heure fixe
- **Nettoyer** la base de données la nuit (supprimer des fichiers temporaires, des sessions expirées…)
- **Synchroniser** vos données avec une API externe toutes les heures
- Générer un **rapport hebdomadaire** automatique

## Comment ça se passe

1. **Description de la tâche** : vous décrivez en une phrase ce que doit faire la tâche (ex: *"envoyer un rapport SEO hebdomadaire par email"*, *"réinitialiser les quotas utilisateur à minuit"*).

2. **Quand l'exécuter** : vous indiquez l'horaire en langage naturel (*"tous les jours à 9h"*, *"chaque lundi matin"*, *"toutes les heures"*). Hypervibe convertit en expression cron UTC.

3. **Nom court** : vous donnez un nom kebab-case pour la tâche (`rapport-hebdo`, `sync-clients`, `nettoyage`).

4. **Choix automatique de l'horloge** : Hypervibe décide elle-même quelle infrastructure utiliser (vous n'avez aucun choix à faire) entre 3 options :
  - **Cloudflare Worker dédié** : précis à la seconde, idéal pour les tâches critiques au timing. 5 places gratuites par compte Cloudflare.
  - **Cloudflare dispatcher mutualisé** : un seul Worker partagé entre tous vos projets. Précis à la minute. Idéal quand les 5 places Cloudflare sont saturées (1 seule place pour N tâches).
  - **GitHub Action** : gratuit, illimité, mais avec **30-60 min de retard possible**. Idéal pour les rapports, digests, cleanups où le timing exact n'a pas d'impact.

5. **Configuration automatique** : selon le choix, Hypervibe scaffold tout, l'horloge, l'endpoint protégé `/api/cron/<nom>` côté Next.js, la clé `CRON_SECRET` (générée si manquante), les secrets GitHub si applicable.

6. **Récap** : Hypervibe vous explique en une phrase **quelle horloge a été choisie et pourquoi** (par exemple : *"je l'ai mise sur l'horloge GitHub car c'est un rapport hebdo, le timing exact n'a pas d'impact"*).

7. **À vous de coder la logique** : la tâche est en place mais ne fait rien encore. Hypervibe a préparé le fichier où vous (ou Claude) écrirez ce qu'elle doit exécuter.

## Ce que ça crée pour vous

- Une **route protégée** `/api/cron/<nom>` côté Next.js (avec vérification du `CRON_SECRET`)
- Une **horloge** sur l'infra adaptée (Cloudflare Worker, dispatcher mutualisé, ou GitHub Action)
- La clé `CRON_SECRET` dans `.env` + Vercel
- Mise à jour de `CLAUDE.md` avec le récap de la tâche

## Prérequis

- Le projet doit être en Next.js déployé sur Vercel (typiquement par `/bootstrap`)
- Pour les horloges Cloudflare : Cloudflare connecté à votre ordi (`/start` s'en occupe). Si Cloudflare n'est pas dispo, Hypervibe bascule automatiquement sur GitHub Action.

## Astuces

{{callout:tip|Vous pouvez piloter en langage naturel}}
Une fois la tâche en place, dites simplement à Hypervibe :
- *"lance la tâche tout de suite pour tester"*, déclenchement manuel
- *"montre-moi les derniers déclenchements"*, historique
- *"change l'horaire pour 10h"*, modification du cron
- *"supprime cette tâche"*, suppression complète

Vous n'avez **rien** à taper dans un terminal.
{{/callout}}

{{callout:info|Pourquoi 3 horloges}}
Cloudflare est précis (à la seconde) mais limité à 5 places gratuites. GitHub Actions est illimité mais peut avoir 30-60 min de retard. Le dispatcher mutualisé est un compromis intelligent : précis à la minute, et consomme une seule place Cloudflare pour N tâches sur N projets. Hypervibe choisit la bonne option pour vous selon la nature de la tâche et la place restante.
{{/callout}}

{{callout:warning|Mauvais candidat pour /add-cron}}
Si votre besoin demande un **processus continu** (24h/7j), un **état persistant en mémoire** entre les exécutions, ou prend **plus de 60 secondes** par exécution, c'est `/add-automation` qu'il faut lancer à la place (pas `/add-cron`). Hypervibe détecte ce cas et vous redirige automatiquement.
{{/callout}}
