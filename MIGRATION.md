# Hypervibe - Migration vers l'horloge partagée unifiée (v2.5)

**FR** : Vous mettez à jour Hypervibe depuis une version antérieure à la 2.5 ? Après avoir mis à jour le plugin, tapez simplement **`/migrate-workers`** dans Claude Code. Il s'occupe de tout, en toute sécurité, avec votre accord à chaque étape, et ne supprime rien avant d'avoir vérifié que le nouveau système fonctionne.

**EN**: Updating Hypervibe from a version older than 2.5? After you update the plugin, just type **`/migrate-workers`** in Claude Code. It handles everything, safely, with your consent at each step, and deletes nothing until it has verified the new setup works.

---

## Ce qui change (le pourquoi) / What changes (the why)

**FR** : Les anciennes versions pouvaient créer jusqu'à trois mécanismes de fond séparés sur votre compte Cloudflare : les sauvegardes de base de données, les alertes de quota, et le déclenchement de vos tâches planifiées. La 2.5 les regroupe en **un seul mécanisme mutualisé** (« votre horloge partagée »), rangé dans un dossier versionné et récupérable, qui n'utilise qu'un seul emplacement Cloudflare pour tous vos projets (il en libère jusqu'à 2 ou 3). Mêmes horaires, même comportement, plus propre.

`/migrate-workers` détecte vos anciens mécanismes, reprend leur configuration à l'identique dans le nouveau, le déploie, **vérifie par un test réel** qu'il fonctionne, puis vous propose de retirer les anciens (jamais sans votre accord). Si vous n'aviez aucun ancien mécanisme (nouvelle installation), la commande vous le dit et ne fait rien.

**EN**: Older versions could create up to three separate background mechanisms on your Cloudflare account: database backups, quota alerts, and the trigger for your scheduled tasks. Version 2.5 merges them into **one shared mechanism** ("your shared clock"), stored in a versioned, recoverable folder, using a single Cloudflare slot for all your projects (it frees up to 2 or 3). Same schedules, same behavior, cleaner.

`/migrate-workers` detects your old mechanisms, carries their configuration over unchanged, deploys the new one, **verifies with a real test run** that it works, then offers to remove the old ones (never without your consent). If you had no old mechanism (fresh install), the command tells you and does nothing.
