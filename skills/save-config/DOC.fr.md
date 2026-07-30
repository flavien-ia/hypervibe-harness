# /save-config

Sauvegarde ta configuration Claude Code (tes règles, tes skills, sa mémoire, tes plugins) dans un dépôt GitHub privé qui t'appartient, et archive ton historique de conversations dans ton cloud. Tout ça vit aujourd'hui dans un seul dossier, sur une seule machine. Tes clés, elles, ne sont jamais copiées : elles restent dans ton coffre.

## Quand l'utiliser

- **Une fois, au début** : tu armes la sauvegarde quotidienne et tu n'y penses plus
- **Avant de bricoler ta config** : nouvelle règle globale, hook, gros ménage dans tes skills
- **Après avoir créé quelque chose que tu ne veux pas refaire** : une skill perso, une routine, des règles affinées pendant des semaines
- **Avant de changer de machine** ou de réinstaller : c'est le moment où on découvre ce qu'on n'avait pas sauvegardé
- **Quand tu veux juste vérifier** que la sauvegarde tourne toujours : relance-la, elle te dit ce qui a changé

## Comment ça se passe

1. **Première fois** : Hypervibe crée un dépôt Git **privé** sur ton compte GitHub (`claude-config`), avec les protections qui empêchent un secret d'y atterrir par accident.

2. **Copie de ta configuration** : uniquement ce qui est utile et non sensible, choisi un par un : ton `CLAUDE.md`, tes skills, tes commandes, tes scripts, les prompts de tes routines, les fichiers mémoire de chaque projet, et le code de tes plugins. Tes conversations, tes caches et tes jetons de connexion ne sont jamais copiés.

3. **Contrôle avant envoi** : avant tout envoi vers GitHub, Hypervibe relit ce qui va partir et cherche des clés API, des clés privées, des jetons. S'il trouve quelque chose, il s'arrête et te dit quel fichier, sans jamais afficher la valeur.

4. **Envoi** : commit daté et envoi sur GitHub. Si rien n'a changé depuis la dernière fois, il ne crée pas de commit vide, il te le dit simplement.

5. **Archives** : ce que Git ne sait pas bien stocker part en ZIP dans ton cloud (Dropbox, OneDrive, iCloud, Google Drive, Nextcloud, pCloud, détecté automatiquement) : ton historique de conversations et l'état qui reconstruit ta barre de gauche (récents et épinglés).

6. **Automatisation** : à la fin, Hypervibe te propose de faire tourner tout ça une fois par jour, tout seul.

## Ce que ça crée pour toi

Deux endroits, avec deux niveaux de sensibilité :

```
github.com/<toi>/claude-config   (dépôt PRIVÉ)
├── CLAUDE.md                    ← tes règles globales
├── settings.json                ← tes réglages (valeurs sensibles masquées)
├── skills/  commands/  scripts/ ← ce que tu as construit
├── scheduled-tasks/             ← les missions de tes routines
├── plugins/                     ← tes plugins, manifests et code
└── memory/<projet>/             ← ce que Claude a retenu de chaque projet

<ton cloud>/Backups/claude-state/
├── interface/   ← ta barre de gauche (récents, épinglés), tous les jours
├── history/     ← tes conversations, une base complète puis les nouveautés
├── config/      ← le dépôt zippé, historique Git inclus
└── RESTORE.md   ← la marche à suivre le jour où tu en auras besoin
```

## Prérequis

- **Git** et un compte **GitHub** connecté (`gh`). Sans GitHub, la sauvegarde fonctionne quand même, mais elle reste sur ta machine, ce qui protège d'une bêtise, pas d'un disque mort.
- **Un dossier cloud synchronisé** pour les archives. S'il n'y en a aucun, Hypervibe te le dit au lieu de faire semblant.
- **Node.js**, déjà là si tu utilises Hypervibe.

## Astuces

{{callout:info|Tes clés ne sont dans aucune de ces sauvegardes}}
C'est volontaire. Les secrets vivent dans ton coffre, qui est déjà synchronisé et chiffré. Un dépôt de configuration, même privé, est le mauvais endroit pour une clé API : il se clone, se partage, se rend public par erreur. Après une réinstallation, tes clés reviennent du coffre.
{{/callout}}

{{callout:warning|Le bloc de réglages qui piège tout le monde}}
Ton fichier de réglages peut contenir un bloc `env` dont les valeurs sont injectées dans toutes tes sessions. C'est très exactement l'endroit où une clé API atterrit quand on suit un tutoriel trop vite. Hypervibe masque ces valeurs avant l'envoi, pour que tes hooks et tes permissions restent restaurables sans que le secret voyage.
{{/callout}}

{{callout:tip|Programme-la en journée, pas la nuit}}
La sauvegarde a besoin de ton coffre déverrouillé pour t'alerter si quelque chose casse, et une session de coffre dure environ 12 heures. Une exécution à 3 h du matin le trouverait fermé. En début d'après-midi, tout fonctionne.
{{/callout}}

{{callout:info|Tes routines suivent ton compte, pas ta machine}}
Le planning de tes routines (l'heure, l'activation) est enregistré sur ton compte Claude, pas dans un fichier de ton disque. Après une réinstallation et une reconnexion, elles reviennent d'elles-mêmes. Ce qui est sauvegardé ici, ce sont leurs missions, le texte qui décrit ce qu'elles doivent faire. Avant d'en recréer une à la main, liste celles qui existent, pour ne pas la faire tourner deux fois.
{{/callout}}
