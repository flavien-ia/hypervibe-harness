# /save-project

Crée une **sauvegarde complète** d'un projet Hypervibe sous forme de zip horodaté. Utile avant `/delete-project`, avant un gros refactor, en fin de mission, ou pour une archive perso.

## Quand l'utiliser

- Avant de lancer **`/delete-project`** sur un projet : ceinture + bretelles, juste au cas où
- Avant un **gros refactor** : un point de retour clair si le refactor part en vrille
- En **fin de mission** : livrer un dump complet au client, ou garder pour vous comme archive
- **Avant une expérimentation risquée** : changement de DB, migration de stack, refonte d'auth...
- Comme **archive annuelle** : un snapshot stocké hors-ligne, déconnecté des services cloud

## Comment ça se passe

1. **Préflight** : Hypervibe détecte le projet (depuis le dossier courant ou l'argument), vérifie que c'est bien un projet Hypervibe (Vercel link, wrangler, git, Next.js), et présente un récap de ce qui sera inclus.

2. **Questions** :
   - **Inclure R2 ?** Si vous avez des buckets Cloudflare R2 (fichiers, images, vidéos uploadées), Hypervibe vous demande si vous les voulez dans le zip. Si beaucoup de contenu, ça peut prendre du temps.
   - **Où sauvegarder le zip ?** Par défaut `Dropbox/Download/`, sinon dossier courant ou chemin de votre choix.

3. **Exécution** : Hypervibe lance en séquence :
   - **Git bundle** complet (toute l'history) + working changes non-commitées capturées en patch
   - **Variables d'environnement Vercel** (production / preview / development)
   - **Dump de la base de données** : schema + une JSON par table
   - **Download R2** (si choisi) : tout le contenu des buckets `<projet>` et `<projet>-eu`
   - **Fichiers mémoire Claude** du projet
   - **Configs** : `.vercel/project.json`, `wrangler.toml`, `render.yaml`, et metadata des webhooks Stripe (URLs et events, **sans les secrets `whsec_...`**)

4. **Zip final** : tout est compressé en `<projet>-snapshot-<TS>.zip` avec un `MANIFEST.md` à la racine qui décrit le contenu et la procédure de restauration.

## Ce que ça crée pour vous

Un zip avec cette structure :

```
<projet>-snapshot-YYYYMMDD-HHMMSS/
├── MANIFEST.md           ← date, contenu, procédure de restauration
├── code/                 ← git bundle + package.json + working-changes.patch
├── db/                   ← schema.json + une JSON par table
├── env/                  ← production.env + preview.env + development.env
├── storage/              ← R2 (si inclus)
├── memory/               ← fichiers mémoire Claude du projet
└── config/               ← Vercel + wrangler + Stripe webhooks metadata
```

## Prérequis

- Le projet doit avoir un dossier local sur la machine (au minimum un `package.json`)
- Vercel CLI et wrangler installés si vous voulez les sections env-vars et R2 (la skill skippe celles qui ne sont pas dispo, sans planter)
- Python est utilisé pour le zip final (déjà installé par défaut sur la machine Hypervibe)

## Astuces

{{callout:warning|Le zip contient des secrets en clair}}
Les fichiers `env/*.env` contiennent vos clés API en clair (DATABASE_URL, STRIPE_SECRET_KEY, etc.). À traiter comme un document confidentiel : pas de partage email non chiffré, pas de stockage public, suppression dès que ce n'est plus utile.
{{/callout}}

{{callout:info|Pas de restauration automatique}}
La skill ne propose pas de `/restore-project`. C'est volontaire : restaurer un environnement complet (DB + R2 + Vercel + DNS + webhooks) est une opération sensible qui mérite des yeux humains à chaque étape. Le `MANIFEST.md` à l'intérieur du zip décrit la procédure étape par étape, et vous pouvez toujours rouvrir Claude Code dans le dossier extrait pour vous faire guider.
{{/callout}}

{{callout:tip|Le filet de sécurité avant /delete-project}}
Le réflexe : avant de supprimer définitivement un projet avec `/delete-project`, lancez d'abord `/save-project`. Vous avez votre zip de secours, puis vous pouvez supprimer en toute sérénité.
{{/callout}}

{{callout:warning|R2 peut être lent}}
Si vos buckets contiennent beaucoup de fichiers volumineux (vidéos, images haute résolution), le download peut prendre plusieurs minutes voire heures. La skill télécharge un objet à la fois pour ne pas saturer votre connexion. Si vous êtes pressé ou que vous n'avez pas besoin du contenu, choisissez "skip R2" : le snapshot inclura quand même tout le reste.
{{/callout}}
