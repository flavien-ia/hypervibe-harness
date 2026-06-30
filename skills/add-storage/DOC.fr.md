# /add-storage

Ajoute le **stockage de fichiers** (images, PDFs, vidéos, documents) à votre app, via Cloudflare R2.

## Quand l'utiliser

- Vos utilisateurs doivent pouvoir **uploader** des fichiers (photo de profil, photos de produits, documents, exports)
- Vous voulez stocker des images et les afficher publiquement (par exemple un site qui vend des produits avec galeries)
- Vous voulez offrir des **téléchargements privés** (rapports, factures, contrats sécurisés)

## Comment ça se passe

1. **Vérification** : si R2 est déjà en place sur le projet, Hypervibe vous propose un menu pour changer de bucket, régénérer les clés, mettre à jour l'URL publique, etc.

2. **Vérification Cloudflare** : Hypervibe vérifie que Cloudflare est connecté à votre ordinateur (token valide). Si non, elle vous renvoie vers `/start`.

3. **Question contenu** : Hypervibe vous demande **ce que vos utilisateurs vont uploader** :
  - Photos de profil / avatars
  - Photos de produits
  - Documents PDF, contrats, factures
  - Exports CSV / Excel / rapports
  - Mixé / autre
   
   Selon votre réponse, elle décide en silence : bucket **public** (URL directe `https://pub-xxx.r2.dev/fichier.jpg`) ou bucket **privé** (URLs signées temporaires, sécurisées).

4. **Activation R2 sur votre compte** : si c'est votre premier bucket R2 sur ce compte Cloudflare, Hypervibe vous redirige vers le dashboard pour activer le service (gratuit jusqu'à 10 Go, mais Cloudflare demande une carte bancaire, non débitée tant que vous restez dans le gratuit).

5. **Création du bucket** : un bucket `<projet>-assets` est créé via la CLI Wrangler.

6. **Scaffolding** :
  - Le SDK S3-compatible (`@aws-sdk/client-s3`) est installé
  - Un fichier `src/server/storage.ts` est créé avec des helpers prêts à l'emploi : `uploadObject`, `deleteObject`, et selon le mode public/privé, soit `getPublicUrl`, soit `getSignedUploadUrl` + `getSignedDownloadUrl`

7. **Push des variables** : `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, et `R2_PUBLIC_URL` (si bucket public) sont poussés dans `.env` + Vercel.

8. **Clés API** (étape manuelle) : Cloudflare ne permet pas de générer ces deux clés automatiquement. Hypervibe vous guide pour créer un token R2 dans dashboard.cloudflare.com → R2 → Manage R2 API tokens → Create account token. Vous collez les deux valeurs (Access Key ID + Secret Access Key), Hypervibe les pousse sur Vercel.

9. **Interface utilisateur (optionnel)** : Hypervibe vous propose de construire l'UI adaptée à votre cas (champ upload + aperçu + galerie + liste personnelle de fichiers + sécurité des accès).

## Ce que ça crée pour vous

- Un **bucket R2** à votre nom (`<projet>-assets`) chez Cloudflare
- Les variables `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (et `R2_PUBLIC_URL` si bucket public) dans `.env` + Vercel
- `src/server/storage.ts` avec les helpers prêts à l'emploi
- Si vous le voulez : l'interface utilisateur (composant d'upload, galerie, liste de fichiers, etc.)

## Prérequis

- Le projet doit être en Next.js (typiquement initialisé par `/bootstrap`)
- Cloudflare connecté à votre ordi (`/start` s'en occupe via le token `CLOUDFLARE_API_TOKEN`)
- R2 activé sur votre compte Cloudflare (Hypervibe vous redirige vers le dashboard si nécessaire)

## Astuces

{{callout:tip|Plan gratuit R2 généreux}}
Cloudflare R2 offre **10 Go de stockage gratuit par mois**, 1 million d'opérations en écriture, 10 millions en lecture, et, particularité unique, **aucun frais quand les fichiers sont téléchargés**. C'est ce qui rend R2 plus économique qu'AWS S3 pour servir des images publiques (S3 facture le trafic sortant, pas R2).
{{/callout}}

{{callout:info|Public vs Privé : la bonne intuition}}
**Public** = n'importe qui avec l'URL peut télécharger le fichier (photos de profil, photos de produits, contenu éditorial, pas confidentiel). **Privé** = chaque téléchargement passe par une URL temporaire signée par votre serveur (factures, contrats, rapports nominatifs). Si vous hésitez, Hypervibe choisit "privé" par défaut (plus sûr).
{{/callout}}

{{callout:warning|Sécurité des données utilisateur}}
En privé, le contrôle d'accès est crucial : votre code doit vérifier que l'utilisateur qui demande un fichier en a bien le droit avant de générer l'URL signée. Si Hypervibe construit l'UI pour vous, ces vérifications sont incluses (vérification de propriété, vérification de session). Si vous écrivez votre propre code, ne supprimez pas ces checks.
{{/callout}}
