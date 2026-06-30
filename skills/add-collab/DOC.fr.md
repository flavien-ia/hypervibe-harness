# /add-collab

Invite ou retire des collaborateurs sur votre projet sans payer une place Vercel par personne. Tout passe par GitHub et un système de déploiement automatique branché en remplacement de l'intégration Vercel native.

## Quand l'utiliser

- Vous voulez **inviter un développeur** à travailler sur votre projet sans payer de licence Vercel supplémentaire
- Vous voulez **retirer un collaborateur** (départ d'un employé, fin de mission, etc.)
- Vous voulez juste voir la liste actuelle de vos collaborateurs

## Comment ça se passe

1. **Détection du setup** : la première fois que vous lancez `/add-collab` sur un projet, Hypervibe détecte que la chaîne de déploiement **GitHub Actions** n'est pas encore configurée. Elle la met en place automatiquement :
  - Token Vercel généré (1 manip dans le dashboard Vercel, Hypervibe vous guide)
  - Les secrets nécessaires sont poussés sur GitHub
  - Un fichier de workflow est créé pour que chaque `git push` vers `main` redéploie en production, et chaque autre branche génère un déploiement de preview
  - **Un dernier réglage côté Vercel à faire vous-même** : suspendre l'intégration native Vercel sur GitHub pour éviter d'avoir deux déploiements en parallèle à chaque push. Hypervibe vous donne les clics exacts.

   Cette mise en place ne se fait qu'**une fois par projet** : les fois suivantes, Hypervibe saute directement à la gestion des collaborateurs.

2. **Liste actuelle** : Hypervibe affiche les collaborateurs en place avec leur rôle (admin / push / triage / read).

3. **Vos actions** : vous dites en langage naturel ce que vous voulez faire :
  - *"Ajoute alice"*, invitation envoyée à l'utilisateur GitHub `alice` avec le rôle `push` par défaut
  - *"Retire bob"*, bob est retiré des collaborateurs immédiatement
  - *"Ajoute charlie et retire dave"*, plusieurs actions en une seule phrase
  - *"Ajoute eve en admin"*, rôle spécifique (vous pouvez aussi demander `pull`, `triage`, `push`, `maintain`)

4. **Vérification + récap** : Hypervibe re-liste les collaborateurs après chaque action pour que vous voyez l'état à jour.

## Ce que ça crée pour vous

- Au premier passage : la **chaîne GitHub Actions** complète (workflow + secrets) qui permet de déployer sans Vercel seats
- Au fil de l'eau : **invitations envoyées** aux collaborateurs (ils reçoivent un email GitHub à accepter)
- **Suppressions immédiates** quand vous retirez quelqu'un

## Prérequis

- Le projet doit être un **repo GitHub** lié à un **projet Vercel** (typiquement après `/bootstrap`)
- Vous devez être le propriétaire (ou avoir les droits admin) du repo

## Astuces

{{callout:tip|Pourquoi GitHub Actions plutôt que Vercel natif}}
Par défaut, Vercel déploie via son intégration GitHub native, mais chaque collaborateur GitHub qui veut voir / déclencher des déploiements doit avoir une **place payante Vercel** (~20$/mois/personne). En basculant sur GitHub Actions, **n'importe quel collaborateur GitHub** peut déclencher un déploiement juste en pushant, pas de seat Vercel supplémentaire à payer. Vous gardez votre seul compte Vercel comme owner.
{{/callout}}

{{callout:warning|Un push = un deploy}}
Une fois la chaîne en place, **tout push** vers `main` (par n'importe quel collaborateur autorisé) déclenche un déploiement production. Les pushs sur d'autres branches créent des preview deployments. Si vous voulez bloquer ça pour certains contributeurs, utilisez les branch protection rules de GitHub (require PR review avant merge sur main).
{{/callout}}

{{callout:info|Retirer un collab ne rollback pas ses déploiements}}
Quand vous retirez quelqu'un, **les déploiements qu'il a déjà faits restent en ligne** : rien n'est annulé automatiquement. Si vous voulez retirer un déploiement spécifique, faites-le manuellement depuis votre dashboard Vercel.
{{/callout}}
