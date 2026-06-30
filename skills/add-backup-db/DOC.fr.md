# /add-backup-db

Active les **sauvegardes automatiques** de votre base de données Neon. Une nouvelle sauvegarde toutes les 2 semaines, conservée intelligemment dans le temps.

## Quand l'utiliser

{{callout:info|Vous n'avez probablement pas besoin de lancer cette commande}}
`/add-backup-db` est lancé **automatiquement** à la fin de `/add-db`, dans le flux normal. Vous n'avez rien à faire. Vous ne devriez avoir à utiliser `/add-backup-db` directement que si la sauvegarde a été ignorée pour une raison technique (Cloudflare ou Neon pas configuré au moment du `/add-db`).
{{/callout}}

- Vous avez ajouté une base de données via `/add-db` et vous voulez vous assurer d'avoir des sauvegardes (c'est en fait **activé automatiquement** par `/add-db`. Vous n'avez pas besoin de lancer `/add-backup-db` à la main dans la plupart des cas)
- Vous voulez relancer l'activation des sauvegardes sur un projet où c'est cassé (clé Neon manquante, Cloudflare pas configuré au moment de `/add-db`, etc.)

## Comment ça se passe

1. **Vérifications** : Hypervibe vérifie que :
  - Wrangler (la CLI Cloudflare) est installé et authentifié
  - Vous avez une **clé Neon API** sauvegardée (`NEON_API_KEY` dans vos variables d'environnement utilisateur, `/start` s'en occupe)
  - Une base Neon est effectivement branchée à votre projet

2. **Déploiement du Worker partagé** : Hypervibe déploie (ou met à jour) un **Cloudflare Worker mutualisé** appelé `db-backup`, qui vit dans `~/.db-backup-worker/` sur votre ordi (en dehors de tout repo, parce qu'il est partagé entre tous vos projets). Le Worker est déclenché par un cron Cloudflare (1er et 15 du mois à 3h UTC).

3. **Enregistrement du projet** : votre projet courant est ajouté à la liste `BACKUP_TARGETS` du Worker. Le Worker fait le tour de tous ses targets à chaque exécution et créé une sauvegarde Neon pour chacun.

4. **Politique de rétention** : pour chaque projet, le Worker maintient un mix intelligent de sauvegardes :
  - **Rolling** (les 2 dernières) : créées à chaque run, on garde toujours les 2 plus récentes
  - **Aging** (jusqu'à 3 historiques) : la sauvegarde la plus récente devient "aging" tous les 3 mois, et est conservée jusqu'à 9 mois max
  - **Total** : 5 branches Neon max par projet (sur 20 du plan gratuit Neon)

## Ce que ça crée pour vous

- Un **Cloudflare Worker** `db-backup` (1er passage uniquement) déployé sur votre compte Cloudflare. Une seule "case" Cloudflare consommée, **même pour 50 projets**.
- Votre projet courant **enregistré** comme target du Worker
- À partir de maintenant, votre base Neon est sauvegardée toutes les 2 semaines, sans intervention

## Prérequis

- Une base Neon en place (via `/add-db`)
- Clé Neon API sauvegardée (via `/start`)
- Cloudflare connecté (via `/start`)

## Astuces

{{callout:tip|Un seul Worker pour N projets}}
Le génie de cette skill : **un seul** Cloudflare Worker partagé fait les sauvegardes de **tous** vos projets. Vous pouvez avoir 30 projets Neon. Ça consomme toujours une seule "case" Cloudflare (sur les 5 du plan gratuit). Le Worker tourne 2 fois par mois et boucle sur la liste.
{{/callout}}

{{callout:warning|Pour restaurer une sauvegarde}}
Si vous voulez restaurer une sauvegarde, allez sur **console.neon.tech** → votre projet → onglet **Branches**. Vous y verrez vos branches `backup-rolling-*` et `backup-aging-*` avec leur date. Vous pouvez ouvrir une branche pour la consulter, ou la promouvoir comme `main` si vous voulez rollback. Si vous avez un doute sur la marche à suivre, demandez à Claude.
{{/callout}}
