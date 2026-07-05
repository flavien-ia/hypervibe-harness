# /add-backup-db

Active les **sauvegardes automatiques** de votre base de données Neon. Une nouvelle sauvegarde toutes les 2 semaines, conservée intelligemment dans le temps.

## Quand l’utiliser

{{callout:info|Vous n’avez probablement pas besoin de lancer cette commande}}
`/add-backup-db` est lancé **automatiquement** à la fin de `/add-db`, dans le flux normal. Vous n’avez rien à faire. Vous ne devriez avoir à utiliser `/add-backup-db` directement que si la sauvegarde a été ignorée pour une raison technique (Cloudflare ou Neon pas configuré au moment du `/add-db`).
{{/callout}}

- Vous avez ajouté une base de données via `/add-db` et vous voulez vous assurer d’avoir des sauvegardes (c’est en fait **activé automatiquement** par `/add-db`. Vous n’avez pas besoin de lancer `/add-backup-db` à la main dans la plupart des cas)
- Vous voulez relancer l’activation des sauvegardes sur un projet où c’est cassé (clé Neon manquante, Cloudflare pas configuré au moment de `/add-db`, etc.)

## Comment ça se passe

1. **Vérifications** : Hypervibe vérifie que :
  - Wrangler (la CLI Cloudflare) est installé et authentifié
  - Votre **clé Neon API** est sauvegardée sur votre ordi (`/start` s’en occupe)
  - Une base Neon est effectivement branchée à votre projet

2. **Votre horloge partagée** : Hypervibe s’assure que votre **horloge partagée** est en place : un mécanisme Cloudflare mutualisé unique (`hypervibe-jobs`) qui sert tous vos projets (tâches planifiées, sauvegardes de base, surveillance de quotas). Elle vit dans `~/.hypervibe-jobs/` sur votre ordi, versionnée avec git, donc chaque modification laisse une trace.

3. **Enregistrement du projet** : votre projet courant est ajouté aux cibles du **job de sauvegarde** de l’horloge. La liste mise à jour est enregistrée (un petit commit git) et l’horloge redéployée. Le 1er et le 15 du mois à 3h UTC, le job fait le tour de toutes ses cibles et crée une sauvegarde Neon pour chacune.

4. **Politique de rétention** : pour chaque projet, le job de sauvegarde maintient un mix intelligent de sauvegardes :
  - **Rolling** (les 2 dernières) : créées à chaque run, on garde toujours les 2 plus récentes
  - **Aging** (jusqu’à 3 historiques) : un nouveau point de contrôle environ tous les 3 mois, conservé 9 mois max
  - **Total** : 5 branches Neon max par projet (sur 20 du plan gratuit Neon)

## Ce que ça crée pour vous

- Le **job de sauvegarde** sur votre horloge partagée (créé la première fois ; les projets suivants s’y ajoutent simplement)
- Votre projet courant **enregistré** comme cible de ce job
- À partir de maintenant, votre base Neon est sauvegardée toutes les 2 semaines, sans intervention
- Une seule place cron Cloudflare consommée **au total**, partagée avec vos tâches planifiées et votre surveillance de quotas, même pour 50 projets

## Prérequis

- Une base Neon en place (via `/add-db`)
- Clé Neon API sauvegardée (via `/start`)
- Cloudflare connecté (via `/start`)

## Astuces

{{callout:tip|Une seule horloge pour tous vos projets}}
Les sauvegardes n’ont plus leur machinerie dédiée : ce sont un job parmi d’autres sur votre **horloge partagée**, le mécanisme mutualisé unique qui exécute aussi vos tâches planifiées et votre surveillance de quotas. Vous pouvez avoir 30 projets Neon : ça consomme toujours une seule place cron Cloudflare au total. Et comme la liste de ce qui est sauvegardé est versionnée (git) sur votre ordi, vous pouvez toujours voir ce qui a changé, et quand.
{{/callout}}

{{callout:warning|Pour restaurer une sauvegarde}}
Si vous voulez restaurer une sauvegarde, allez sur **console.neon.tech** → votre projet → onglet **Branches**. Vous y verrez vos branches de sauvegarde avec leur date : `bk-<projet>-r-*` pour les rolling, `bk-<projet>-a-*` pour les points de contrôle trimestriels. Vous pouvez ouvrir une branche pour la consulter, ou la promouvoir comme `main` si vous voulez rollback. Si vous avez un doute sur la marche à suivre, demandez à Claude.
{{/callout}}
