# /update-hypervibe

Met Hypervibe à jour vers la dernière version publiée, sans quitter votre conversation.

## Quand l’utiliser

{{callout:info|Cela dépend de la façon dont vous avez installé Hypervibe}}
Si vous avez installé le plugin **avec une commande** (`/plugin marketplace add flavien-ia/hypervibe-harness`), Claude Code le tient déjà à jour tout seul. Cette commande vous le dira et vous donnera la commande native, plutôt que d’agir dans son dos.
{{/callout}}

- Vous avez installé Hypervibe en **téléversant le zip** dans Claude Desktop, et vous voulez savoir si une version plus récente est sortie
- Une nouvelle version a été annoncée et vous la voulez sans refaire l’installation à la main
- Vous voulez simplement savoir quelle version vous utilisez

## Comment ça se passe

1. **Elle regarde comment le plugin a été installé.** Claude Code tient un registre de la provenance de chaque plugin. Hypervibe le lit au lieu de deviner.

2. **Elle compare les versions.** La vôtre face à celle publiée dans le dépôt public. Si c’est la même, elle s’arrête là et vous le dit.

3. **Elle télécharge la nouvelle version** depuis hypervibe.fr. Sans compte ni clé : le plugin est open source (Apache 2.0).

4. **Elle vérifie l’archive avant de toucher à quoi que ce soit.** La nouvelle version est déballée dans un dossier à part et inspectée : est-ce bien un plugin complet, la version est-elle celle attendue, rien n’essaie-t-il d’écrire en dehors de son dossier. Votre installation qui fonctionne n’est pas touchée tant que ces contrôles ne sont pas passés.

5. **Elle permute les dossiers et garde une sauvegarde.** L’ancienne version est mise de côté sous le nom `hypervibe-backup-<version>`. Si une étape échoue, elle est remise en place immédiatement : vous ne vous retrouvez jamais sans plugin.

6. **Elle vous demande de relancer Claude Code**, c’est ce qui charge réellement la nouvelle version.

## Ce que vous obtenez

- Le plugin mis à jour sur place, au même endroit
- La version précédente conservée en sauvegarde juste à côté, jusqu’à ce que vous décidiez de l’effacer
- Le catalogue local des plugins remis d’accord avec le nouveau numéro de version

## Bon à savoir

- **La sauvegarde n’est pas supprimée toute seule.** Relancez, vérifiez que tout fonctionne, puis demandez à la retirer.
- **Une mise à jour ratée ne vous coûte rien** : la version précédente est restaurée d’elle-même, et la commande vous dit ce qui a échoué.
- **Rien n’est envoyé nulle part.** La vérification lit un fichier public, le téléchargement est anonyme.
