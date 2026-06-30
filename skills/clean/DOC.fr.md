# /clean

Détecte et supprime tout ce qui n'est plus utilisé dans votre projet pour l'alléger. Fichiers orphelins, code mort, dépendances inutiles, variables d'environnement et tables DB sans usage : les suppressions validées sont appliquées sur une branche séparée pour que vous puissiez vérifier avant de merger.

## Quand l'utiliser

- Vous voulez **alléger** votre projet après plusieurs mois d'évolutions
- Vous voulez **identifier** ce qui pourrait poser problème (variables d'env obsolètes, tables DB sans caller, etc.)
- Vous suspectez du code mort laissé par d'anciennes itérations en vibe coding

## Comment ça se passe

1. **Disclaimer affiché en début** : Hypervibe rappelle que c'est un diagnostic. Certaines trouvailles peuvent être des faux positifs (imports dynamiques, références en base, etc.). **Rien n'est supprimé sans votre validation explicite.**

2. **Audit complet** : Hypervibe scan votre projet selon plusieurs catégories :
  - **Fichiers orphelins** (fichiers qui ne sont importés nulle part)
  - **Code mort** (exports, fonctions, composants jamais utilisés)
  - **Déchets IA** (stubs, doublons, TODO laissés en plan)
  - **Dépendances inutilisées** (packages dans `package.json` mais jamais importés)
  - **Variables d'env orphelines** (déclarées dans `.env` ou Vercel mais jamais lues côté code)
  - **Tables DB sans caller** (tables Drizzle qui ne sont lues / écrites nulle part)
  - **Migrations obsolètes** (fichiers Drizzle qui ne servent plus)

3. **Rapport pédagogique** : pour chaque trouvaille, Hypervibe affiche :
  - **Niveau de certitude** (sûr / probable / à vérifier)
  - **Niveau de danger** (sans risque / risque modéré / vérifie bien avant)
  - **Vérifications faites** : Hypervibe a déjà fait tous les checks techniques (greps, etc.). Vous voyez les faits, pas une todo-list.
  - **À vérifier (vous seul pouvez répondre)** : des questions sur vos intentions ou des références externes (newsletter, post LinkedIn, etc.) qu'Hypervibe ne peut pas connaître.

4. **Vous validez ce que vous voulez supprimer** : à la carte. Vous pouvez tout accepter, tout refuser, ou trier ligne par ligne.

5. **Application sur une branche séparée** : Hypervibe crée une branche `cleanup-<date>`, applique les suppressions (côté code **ET** côté DB Neon si applicable), commit, push. Vous testez en preview Vercel.

6. **Merge** : une fois que vous êtes sûr que rien n'est cassé, vous mergez. Si quelque chose pose problème, vous abandonnez la branche, rien n'est merged dans `main`.

## Ce que ça crée pour vous

- Un **rapport d'hygiène** complet du projet
- Une **branche `cleanup-*`** avec les suppressions validées (code + DB)
- Un commit propre par catégorie de suppression
- Rien n'est touché tant que vous ne mergez pas

## Prérequis

- Aucun prérequis particulier, `/clean` peut tourner sur n'importe quel projet du plugin
- Mieux vaut avoir Git propre (rien de non-commité) avant de lancer, pour ne pas mélanger vos changements en cours avec les suppressions

## Astuces

{{callout:warning|Toujours tester la preview avant de merger}}
La branche `cleanup-*` déclenche un déploiement preview sur Vercel. Cliquez sur le lien preview et **testez vraiment** votre site avant de merger : chaque page principale, chaque formulaire, chaque action utilisateur importante. Une dépendance peut être chargée dynamiquement à un moment particulier qu'Hypervibe n'a pas pu détecter statiquement.
{{/callout}}

{{callout:tip|Annuler facilement si problème}}
Si vous découvrez qu'un truc cassé sur la preview après le clean : pas de panique. Vous n'avez pas mergé, donc votre `main` est intact. Vous pouvez soit abandonner la branche (suppression Git), soit demander à Hypervibe d'annuler seulement la suppression qui pose problème.
{{/callout}}

{{callout:info|DB = aussi nettoyée}}
Si une table Drizzle n'est plus utilisée dans le code (Hypervibe vérifie 0 occurrence de `db.select` / `db.insert` / `db.update` / `db.query` sur cette table dans `src/`), elle est proposée à la suppression côté DB. Hypervibe utilise alors un DROP TABLE sur votre Neon. C'est **destructif** côté DB, réfléchissez avant de valider. Une sauvegarde Neon récente vous protège (si `/add-backup-db` est actif, vous en avez forcément une de moins de 2 semaines).
{{/callout}}
