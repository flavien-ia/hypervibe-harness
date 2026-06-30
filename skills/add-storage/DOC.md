# /add-storage

Adds **file storage** (images, PDFs, videos, documents) to your app, via Cloudflare R2.

## When to use it

- Your users need to be able to **upload** files (profile photo, product photos, documents, exports)
- You want to store images and display them publicly (for example a site that sells products with galleries)
- You want to offer **private downloads** (reports, invoices, secure contracts)

## How it works

1. **Check**: if R2 is already in place on the project, Hypervibe offers you a menu to switch bucket, regenerate the keys, update the public URL, etc.

2. **Cloudflare check**: Hypervibe verifies that Cloudflare is connected to your computer (valid token). If not, it sends you to `/start`.

3. **Content question**: Hypervibe asks you **what your users will upload**:
  - Profile photos / avatars
  - Product photos
  - PDF documents, contracts, invoices
  - CSV / Excel / report exports
  - Mixed / other
   
   Depending on your answer, it silently decides: **public** bucket (direct URL `https://pub-xxx.r2.dev/fichier.jpg`) or **private** bucket (temporary signed URLs, secure).

4. **R2 activation on your account**: if this is your first R2 bucket on this Cloudflare account, Hypervibe redirects you to the dashboard to enable the service (free up to 10 GB, but Cloudflare asks for a credit card, not charged as long as you stay within the free tier).

5. **Bucket creation**: a bucket `<projet>-assets` is created via the Wrangler CLI.

6. **Scaffolding**:
  - The S3-compatible SDK (`@aws-sdk/client-s3`) is installed
  - A file `src/server/storage.ts` is created with ready-to-use helpers: `uploadObject`, `deleteObject`, and depending on the public/private mode, either `getPublicUrl`, or `getSignedUploadUrl` + `getSignedDownloadUrl`

7. **Variable push**: `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, and `R2_PUBLIC_URL` (if public bucket) are pushed to `.env` + Vercel.

8. **API keys** (manual step): Cloudflare does not allow generating these two keys automatically. Hypervibe guides you to create an R2 token in dashboard.cloudflare.com → R2 → Manage R2 API tokens → Create account token. You paste the two values (Access Key ID + Secret Access Key), Hypervibe pushes them to Vercel.

9. **User interface (optional)**: Hypervibe offers to build the UI adapted to your case (upload field + preview + gallery + personal file list + access security).

## What it creates for you

- An **R2 bucket** in your name (`<projet>-assets`) at Cloudflare
- The variables `CLOUDFLARE_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (and `R2_PUBLIC_URL` if public bucket) in `.env` + Vercel
- `src/server/storage.ts` with the ready-to-use helpers
- If you want: the user interface (upload component, gallery, file list, etc.)

## Prerequisites

- The project must be in Next.js (typically initialized by `/bootstrap`)
- Cloudflare connected to your computer (`/start` takes care of it via the `CLOUDFLARE_API_TOKEN` token)
- R2 enabled on your Cloudflare account (Hypervibe redirects you to the dashboard if necessary)

## Tips

{{callout:tip|Generous R2 free plan}}
Cloudflare R2 offers **10 GB of free storage per month**, 1 million write operations, 10 million read operations, and, a unique feature, **no charge when files are downloaded**. This is what makes R2 more economical than AWS S3 for serving public images (S3 bills outgoing traffic, R2 does not).
{{/callout}}

{{callout:info|Public vs Private: the right intuition}}
**Public** = anyone with the URL can download the file (profile photos, product photos, editorial content, not confidential). **Private** = each download goes through a temporary URL signed by your server (invoices, contracts, personal reports). If you are unsure, Hypervibe chooses "private" by default (safer).
{{/callout}}

{{callout:warning|User data security}}
In private mode, access control is crucial: your code must verify that the user requesting a file is actually entitled to it before generating the signed URL. If Hypervibe builds the UI for you, these checks are included (ownership verification, session verification). If you write your own code, do not remove these checks.
{{/callout}}
