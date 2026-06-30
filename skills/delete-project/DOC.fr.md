# /delete-project

Supprime proprement et définitivement un projet Hypervibe et toute son infrastructure cloud associée. Avant toute action, un gros avertissement et une double confirmation, car l'opération est **irréversible** (base de données, hébergement, fichiers stockés, sauvegardes, domaines, webhooks de paiement, services cloud).

## Quand l'utiliser

- Vous abandonnez un projet (test, prototype, app obsolète) et vous voulez **tout nettoyer** pour ne pas laisser traîner d'infrastructure cloud
- Vous voulez **éviter de payer** pour des services restés actifs (Render, Stripe live, Neon hors free tier, etc.)
- Vous voulez **libérer des quotas** sur vos plans gratuits (Cloudflare R2, Neon, Vercel) pour vos prochains projets
- Vous voulez **décommissionner** une app qui ne sera plus utilisée (fin de mission, départ d'un client, refonte complète)

## Comment ça se passe

La suppression se fait en **4 phases**, avec un point de validation explicite à chaque étape critique.

**Phase 1 : Identification + gros avertissement**

1. Hypervibe vous demande le nom exact du projet à supprimer (si pas déjà fourni en argument).
2. Un avertissement plein écran s'affiche, listant tout ce qui va être supprimé : données, sauvegardes, site en ligne, fichiers stockés, abonnements payants éventuels.
3. **Première confirmation** : Hypervibe vous propose 3 options :
  - Oui, je confirme la suppression définitive
  - Non, juste mettre en pause (suspendre Vercel, mettre la base en veille, sans rien supprimer)
  - Non, j'annule
4. **Seconde confirmation** : Hypervibe vous demande de **retaper le nom exact** du projet (sensible à la casse) pour valider. Si la chaîne ne matche pas, la skill s'arrête.

**Phase 2 : Inventaire complet**

Hypervibe lance un scan parallèle sur **16 surfaces** pour identifier tout ce qui appartient au projet :
- Hébergement (Vercel)
- Base de données (Neon)
- Stockage de fichiers (Cloudflare R2, en versions globale et européenne)
- Automatisations (Cloudflare Workers)
- Domaines et DNS, redirection d'emails (Cloudflare)
- Sauvegardes automatiques (worker `db-backup` partagé entre vos projets)
- Workers de fond (Render)
- Paiements (webhooks Stripe)
- Caches et files d'attente (Upstash)
- Variables d'environnement locales et sur Vercel
- Dossier de code local + dépendances
- Mémoire Claude du projet
- Repo GitHub

Le scan détecte aussi **les services tiers** branchés hors stack Hypervibe (Sentry, OpenAI, Mapbox, Notion, etc.) en analysant vos variables d'environnement.

**Phase 3 : Choix de la portée**

Hypervibe vous présente un récap clair en 4 sections :

- **🔵 Infrastructure Hypervibe** que la skill peut supprimer automatiquement
- **🟠 Services tiers détectés** à supprimer vous-même (Hypervibe vous donne pour chacun l'URL exacte et les étapes clic-par-clic)
- **🟡 Actions manuelles obligatoires** (suppression du dossier local, du repo GitHub, des clients OAuth Google/GitHub) que la skill ne peut pas faire pour vous
- **⚪ Volontairement non touché** (Brevo/Resend partagés, zones Cloudflare parentes, produits Stripe)

Vous choisissez : tout supprimer, ou garder certaines briques (DB, DNS, dossier local). La skill ne lance rien tant que ce choix n'est pas validé.

**Phase 4 : Exécution + rapport**

Hypervibe enchaîne les suppressions en parallèle où c'est possible (Vercel, R2, Workers, DNS, Stripe webhooks, Render, Upstash, Email Routing) puis en série là où il y a des dépendances (Neon, puis retrait du projet dans le worker `db-backup` partagé, puis mémoire Claude).

À la fin, un rapport vous montre :
- ✅ Ce qui a été supprimé automatiquement
- 🟡 Les actions manuelles qu'il vous reste à faire (dossier local, repo GitHub, OAuth, services tiers détectés), avec pour chacune le chemin exact et les clics à faire
- ℹ️ Ce qui a été volontairement laissé en place

## Ce que ça fait pour vous

- Supprime **toute l'infrastructure Hypervibe** automatisable du projet en une seule passe
- Détecte **proactivement les services tiers** que vous avez branchés en cours de route et qui pourraient continuer à facturer
- Vous donne pour chaque action restante **l'URL exacte et les instructions clic-par-clic**
- Préserve **les services partagés** (Brevo, Resend, zones Cloudflare parentes, sauvegardes automatiques des autres projets) sans rien y toucher
- Garantit qu'**aucune ressource orpheline ne traîne** dans vos comptes cloud

## Prérequis

- Le projet doit être un projet Hypervibe (créé via `/bootstrap`)
- Vous devez être connecté aux services concernés (`/start` s'en occupe pour Vercel, Cloudflare, GitHub, Neon)
- Vous devez avoir le droit administrateur sur le projet (typiquement le cas si vous l'avez créé)

## Astuces

{{callout:warning|L'opération est strictement irréversible}}
Une fois la suppression lancée, **aucune donnée ne peut être récupérée**. Si votre projet contient des informations importantes (vraies commandes, comptes utilisateurs, photos uploadées par des clients...), prenez d'abord une sauvegarde manuelle (export DB, copie du dossier local, dump des fichiers R2) avant de lancer la skill. La double confirmation existe précisément pour ça.
{{/callout}}

{{callout:tip|Vous pouvez juste mettre en pause}}
Si vous hésitez à supprimer définitivement, choisissez l'option "juste mettre en pause" à la première confirmation. Hypervibe suspend le projet Vercel et met la base Neon en veille : aucune dépense, aucun trafic, mais rien n'est perdu. Vous pourrez réactiver plus tard si besoin, ou relancer `/delete-project` pour supprimer pour de bon.
{{/callout}}

{{callout:info|Garde le contrôle sur ce qui est supprimé}}
À la Phase 3, vous n'êtes pas obligé de tout supprimer en bloc. Vous pouvez par exemple garder la base de données (pour récupérer les données plus tard) tout en supprimant l'hébergement, ou garder le DNS (pour réutiliser le domaine sur un nouveau projet) tout en nettoyant le reste. Hypervibe vous propose chaque option à la carte.
{{/callout}}

{{callout:info|Le dossier local et le repo GitHub restent à votre charge}}
Pour des raisons de sécurité, Hypervibe ne supprime jamais le dossier de code sur votre ordinateur, ni le repo GitHub. Vous recevez à la fin du processus le chemin exact à ouvrir dans l'explorateur Windows pour supprimer le dossier, et l'URL GitHub pour supprimer le repo (dans Settings : Danger Zone). C'est une étape consciente pour éviter de perdre du code par erreur.
{{/callout}}
