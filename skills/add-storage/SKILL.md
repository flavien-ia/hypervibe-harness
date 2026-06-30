---
name: add-storage
description: Add Cloudflare R2 file/image storage to an existing T3 project. Asks upfront what will be stored to infer public/private + propose UI build at the end.
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## ⚠️ Before any call to `wrangler` (to be done BEFORE any other wrangler command in this skill)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

This line loads `CLOUDFLARE_API_TOKEN` from User scope (Windows registry / shell rc on Mac/Linux) if it is not in `process.env`, and adds the pnpm bin to the PATH (for bash sessions where `pnpm setup` has not propagated yet). Without it, `wrangler` fails with "command not found" on Mac (Spotlight), or may use a different Cloudflare account than the one the user expects.


# Add Storage - Cloudflare R2 Configuration

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Adds Cloudflare R2 bucket and S3-compatible upload utility, then proposes to build the user-facing layer (upload field, gallery, download link, etc.) adapted to what the user wants to store.

---


## Preflight - vault open

This skill reads the Cloudflare (R2) token from the vault → first, make sure it is unlocked (follow **`_ensure-vault`**): `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status` → if `locked`/`expired`, run `launch.mjs unlock`; if the vault does not exist, delegate to `_add-keyring`.

---

## Step 0 - Preflight: R2 already configured?

**First of all**, invoke `_check-deps storage` to detect whether R2 is already in place:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" storage)
storage_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).storage.ok)")
storage_bucket=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).storage.bucket || '(not set)')")
storage_jurisdiction=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).storage.jurisdiction || 'unknown')")
storage_warning=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).storage.jurisdictionWarning || '')")
```

### If `storage_ok = true` → reconfiguration mode

R2 is already in place (bucket: `$storage_bucket`, jurisdiction: `$storage_jurisdiction`). Do NOT recreate the S3 client, nor rewrite the upload utility.

**If `$storage_jurisdiction != "eu"`** (default or unknown jurisdiction) → first show a warning BEFORE the menu:

> ⚠️ **R2 jurisdiction warning**: your bucket `$storage_bucket` is in the default jurisdiction (Cloudflare global), not the strict EU jurisdiction. In practice, the files may be stored in any Cloudflare datacenter (USA included), which is not optimal from a GDPR standpoint. A migration to the EU jurisdiction is recommended (option 5 of the menu below).

Then show the menu:

> ## 📦 R2 storage (Cloudflare) is already in place on your project (bucket: **$storage_bucket**)
>
> What do you want to do?
>
> 1. **Switch bucket** (e.g. go from a private bucket to a public bucket with a public URL) - I create the new bucket and switch `R2_BUCKET_NAME`
> 2. **Regenerate the R2 access keys** (security rotation, or if you fear a leak)
> 3. **Change the public URL** (`R2_PUBLIC_URL`) after connecting a custom domain to the bucket
> 4. **Start over from scratch** (only useful if the R2 config is broken - first remove the `R2_*` keys from the local `.env`)
> 5. **Migrate to the EU jurisdiction** (recommended if not done yet - copies the content to a strict EU bucket + switches the env vars, ~5-30 min depending on the size)
> 6. **Something else** - tell me what you want

Wait for the answer.

**Depending on the answer**:

| Choice | Action |
|---|---|
| 1 (switch bucket) | Ask for the new bucket name + public/private. Create it via `wrangler r2 bucket create <nom> -J eu` (strict EU jurisdiction, GDPR - NEVER omit `-J eu`). Push `R2_BUCKET_NAME=<nouveau>` via `_push-env-vars`. Remind that the files in the old bucket are not migrated automatically. |
| 2 (key rotation) | Guide to the Cloudflare dashboard → R2 → Manage R2 API tokens → Revoke the old one + Create new token with the same permissions on the bucket. Push `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` via `_push-env-vars`. |
| 3 (update public URL) | Ask for the new public URL (e.g. `https://assets.mydomain.com`). Push `R2_PUBLIC_URL=<url>` via `_push-env-vars`. Remind that on the Cloudflare side, a custom domain must have been connected to the bucket via the R2 dashboard. |
| 4 (start over) | Abort: ask the user to manually clean up their R2 env vars, then re-run. |
| 5 (migrate to EU) | Start the migration: create a temp EU bucket, copy the objects, delete the old bucket, recreate it in EU with the same name, copy back from temp, update `R2_ENDPOINT` (with `.eu.`) and `R2_PUBLIC_URL` (new hash), enable public access on the EU side. Details: see the pattern used in the hyperart migration of 2026-05-13 (Node script with `@aws-sdk/client-s3`, two S3 clients where the destination uses the `.eu.r2.cloudflarestorage.com` endpoint). The existing R2 token can be reused if its scope is updated on the new bucket via the dashboard. |
| 6 (something else) | Ask for clarification. Do not run the full flow by default. |

**At the end**, jump directly to the **final summary**.

### If `storage_ok = false` (not configured yet)

Continue normally to Step 1. This is the initial installation flow.

---

## Step 1 - Check prerequisites

Invoke the `_detect-project-root` internal skill to get `PROJECT_NAME`, `WEB_DIR`, `IS_NEXTJS`. Abort if `IS_NEXTJS=no`.

### 1.a - Check the Cloudflare token

R2 is managed by Cloudflare, so the skill requires Cloudflare to already be connected to your environment. We check via `_check-deps cloudflare` (which validates both the presence AND the validity of the token):

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" cloudflare)
cf_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).cloudflare.ok)")
```

**If `cf_ok = false`** → route to `/start` (same pattern as `/add-domain` and `/new-email-address`). `/start` installs Wrangler and configures `CLOUDFLARE_API_TOKEN` in one go - no need to do it again here:

> R2 storage goes through Cloudflare, and I need your Cloudflare account connected to your computer. That is not done yet.
>
> Run **`/start`** - it installs Wrangler (the Cloudflare CLI) and configures the API token in 2 guided minutes. Then re-run `/add-storage` and I will pick up here.

Do not continue until `cf_ok = true`.

### 1.b - Safety: is Wrangler properly present?

The token is there. In 99% of cases, Wrangler was also installed by `/start` (it is one of the 6 essentials). We check anyway in case the user uninstalled it manually:

```bash
wrangler --version 2>/dev/null
wrangler whoami 2>/dev/null
```

**If either of the two commands fails** → fallback: invoke `_setup-wrangler` to (re)install and re-verify. Then re-check `wrangler whoami` before continuing.

**If both pass** → Wrangler is ready, continue to Step 2.

## Step 2 - Context: what will be stored?

Before touching the code, understand what the user wants to store. This determines:
- The bucket visibility (public or private) → inferred by Claude
- The generated code (direct URLs vs signed URLs)
- The UI proposed at the end

Ask in natural language:

> Before configuring storage, tell me what your users will be able to add on your site:
>
> A few examples:
> - profile photos
> - product photos
> - PDF documents (contracts, invoices, quotes...)
> - Excel files or reports
> - something else?
>
> You can list several. If you do not know yet, say so, we will configure the essentials and you can enrich it later.

**Internal inference** (DO NOT show to the user) - Claude classifies based on the answers:

| Type provided by the user | Technical visibility | DB tracking | Typical UI to propose |
|---|---|---|---|
| profile photos / avatars | Public (direct URL) | `avatarUrl` field on user | "add a photo" field + preview |
| product photos | Public | table with a list of images per product | multi upload + admin mini-gallery |
| PDF documents, contracts, invoices | **Private** (signed URLs) | table with owner + access check | upload + personal downloadable list |
| generated CSV / Excel / reports exports | **Private** (signed URLs, short expiry) | optional (single-use link) | "Export" button + download link |
| mixed public + private | **Private by default** + signed URLs everywhere (safer) | mandatory | depends on the types |
| to be defined | **Private** by default (safer) | optional | generic upload |

Store `<storage_context>` = `{types, visibility, db_tracking}` for the following Steps.

## Step 3 - Check existing buckets and inform about pricing

List existing R2 buckets **in both jurisdictions** (default + EU) and sum them for the total count, because the skill always creates the new buckets in the strict EU jurisdiction but the user may have existing buckets in both jurisdictions:

```bash
wrangler r2 bucket list 2>&1          # default jurisdiction
wrangler r2 bucket list -J eu 2>&1    # EU jurisdiction
```

The main purpose of this double listing is (a) to detect whether R2 is enabled on the account and (b) to display a correct total count in the pricing message below.

### 3.a - If R2 is not yet enabled on the account

If the command fails with a message like `R2 is not enabled`, `must purchase R2`, `subscription required`, `must sign up for R2`, or `10000` (the Cloudflare error code when R2 is not enabled) → R2 has never been enabled on this Cloudflare account. It is free up to 10 GB but Cloudflare requires a credit card to enable the service (never charged as long as you stay within the free tier).

Show to the user:

> R2 is not yet enabled on your Cloudflare account. To enable it (free up to 10 GB, but Cloudflare asks for a credit card to open the service - it is not charged as long as you stay within the free tier):
>
> 1. Go to **https://dash.cloudflare.com/**
> 2. In the left menu: **Storage & Databases** → **R2 Object Storage** → **Overview**
> 3. Click on **"Add R2 subscription to my account"**
> 4. Enter your credit card (required to enable, but no charge as long as you do not exceed the free tier)
> 5. Once validated, click on **"Continue to R2"**
>
> Tell me when it is done and I will pick up again.

Wait for the user's confirmation, then re-try `wrangler r2 bucket list`. If it passes → continue. If it still fails with the same error → ask the user to check that they have actually finalized the activation on the dashboard side.

### 3.b - R2 is enabled: inform about pricing

Inform the user:

> You currently have X R2 storage bucket(s). The Cloudflare R2 free plan includes:
> - **10 GB** of storage / month
> - **1M** write operations / month
> - **10M** read operations / month
> - **No charge** when a file is downloaded (free egress)
>
> Beyond the free tier: $0.015/GB/month. Check your usage on https://dash.cloudflare.com/ → R2 → Overview.

## Step 4 - Create R2 bucket

**Always in strict EU jurisdiction** (`-J eu`) for GDPR compliance. The data stored in this bucket can never leave the European Union, unlike the default global jurisdiction which may place the files in any Cloudflare datacenter (USA included).

```bash
wrangler r2 bucket create <PROJECT_NAME>-assets -J eu
```

**If `<storage_context>.visibility = "public"`**: also enable public access on this bucket to allow direct URLs (`https://pub-<hash>.r2.dev/<key>`). The `-J eu` flag is MANDATORY here too, otherwise Wrangler looks in the global jurisdiction and does not find the bucket:
```bash
wrangler r2 bucket dev-url enable <PROJECT_NAME>-assets -J eu
```
Retrieve the returned `pub-...r2.dev` URL and store it as `R2_PUBLIC_URL`.

**If `<storage_context>.visibility = "private"`**: do NOT enable public access. All downloads will go through signed URLs generated server-side (the Step 5 code does this).

**⚠️ Important for what follows**: any future `wrangler r2 ...` command on this bucket (info, delete, dev-url disable, etc.) must include `-J eu`. Without this flag, Wrangler returns "bucket not found" because it queries the global jurisdiction. To be documented in the project's CLAUDE.md in Step 7.

## Step 5 - Install S3 client and create upload utility

```bash
pnpm add @aws-sdk/client-s3
```

(If visibility = private, also add `pnpm add @aws-sdk/s3-request-presigner` for the signed URLs.)

Create `<WEB_DIR>/src/server/storage.ts` with the S3-compatible R2 client and the appropriate helpers:
- `uploadObject(key, body, contentType)` - upload from the server (common to both modes)
- `deleteObject(key)` - deletion (common)
- **If public**: `getPublicUrl(key)` - returns `<R2_PUBLIC_URL>/<key>` directly
- **If private**: `getSignedUploadUrl(key, contentType, expiresIn=3600)` - for direct uploads from the browser, AND `getSignedDownloadUrl(key, expiresIn=3600)` - for temporary downloads

## Step 6 - Push non-secret env vars

Invoke `_push-env-vars` with:
- `CLOUDFLARE_ACCOUNT_ID=<from wrangler whoami>`
- `R2_BUCKET_NAME=<PROJECT_NAME>-assets`
- `R2_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com` (note the `.eu.` - the S3 endpoint of a bucket in EU jurisdiction is different from the global endpoint)
- **If public**: also add `R2_PUBLIC_URL=<the pub-...r2.dev URL retrieved in Step 4>`

**Do NOT push `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` here** - created manually by the user in Step 8.

## Step 7 - Update CLAUDE.md

Invoke `_update-claude-md` with:
- `stack`: `- **Storage**: Cloudflare R2 ([public|private] depending on context, strict EU jurisdiction, util in \`<WEB_DIR>/src/server/storage.ts\`)`
- `conventions`:
  - `- R2 storage: when deleting a record (or a field) that references an uploaded file, **always** also delete the corresponding R2 object via \`deleteObject(key)\` (from \`~/server/storage\`) in the same operation. Never delete only the database row: that leaves orphaned files in the bucket (storage cost that grows + data that survives its deletion, a GDPR problem). Same for a file replacement: delete the old R2 object after uploading the new one. For a multiple deletion (e.g. deleting a product with 5 photos), delete all the associated R2 keys.`
- `env-vars`:
  - `- \`CLOUDFLARE_ACCOUNT_ID\` - Cloudflare account ID`
  - `- \`R2_ACCESS_KEY_ID\` - R2 API token access key (created manually)`
  - `- \`R2_SECRET_ACCESS_KEY\` - R2 API token secret (created manually)`
  - `- \`R2_BUCKET_NAME\` - R2 bucket name`
  - `- \`R2_ENDPOINT\` - S3-compatible R2 endpoint (EU format: \`.eu.r2.cloudflarestorage.com\`)`
  - **If public**: `- \`R2_PUBLIC_URL\` - public URL of the bucket to serve files directly`
- `custom`:
  - heading: `## R2 storage - context`
  - body: content based on `<storage_context>` from Step 2. Format:
    ```
    Bucket: <PROJECT_NAME>-assets ([public | private with signed URLs], **strict EU jurisdiction** - data guaranteed in the EU, never moved outside the European Union)

    Important: any `wrangler r2 ...` command on this bucket must include the `-J eu` flag (otherwise Wrangler queries the global jurisdiction and returns "bucket not found").

    Types of files stored:
    - <type 1 provided by the user>
    - <type 2>
    ...

    DB tracking: [yes (table to create) | no (just a url field)]

    UI: [in place | to build - see CLAUDE.md "To do" if skipped]
    ```

## Step 8 - Manual: API credentials

R2 requires S3 credentials separate from the Cloudflare API token (Cloudflare limitation). This step must be done by the user:

> To finish wiring up R2, I need 2 keys that you have to create yourself (Cloudflare does not allow generating them automatically):
>
> 1. Go to **https://dash.cloudflare.com/**
> 2. In the left bar, click on **Storage & databases** → **R2 Object Storage** → **Overview**
> 3. On the page that opens, at the bottom right in the **"Account details"** box, click on **"{} Manage"**
> 4. Click on **"Create account API token"**
> 5. **Rename the token** with the name of the application (`<PROJECT_NAME>`) + **Permissions**: **"Object Read & Write"** + select **"Apply to specific buckets only"** and choose the bucket that was just created (`<PROJECT_NAME>-assets`)
> 6. Click on **"Create Account API Token"** at the bottom
> 7. Cloudflare displays (only once) an **Access Key ID** and a **Secret Access Key**: paste them to me here, I push them to `.env` + Vercel

When the user provides the 2 keys, invoke `_push-env-vars` with:
- `R2_ACCESS_KEY_ID=<access key provided>`
- `R2_SECRET_ACCESS_KEY=<secret key provided>`

## Step 9 - Propose to build the user-facing layer

Storage is wired up on the server side ✅. But for your users to actually be able to add and view files, you now need the UI. Adapt the proposal to `<storage_context>` from Step 2 - describe to the user **what they will get** (in plain language), not how it is built.

**Examples of proposals by type** (Claude adapts to the actual types provided):

| Type | Proposal to the user (no jargon) |
|---|---|
| profile photos | "a field to add a profile photo (with preview before confirming) and the display of the photo throughout the app" |
| product photos | "an admin page to add / remove photos on each product, with the display of the galleries on the visitor side" |
| PDF documents / contracts | "a place to add a document, and a personal page where each user finds their own files and can download them (secure: no one else can access them)" |
| CSV/Excel exports | "an 'Export' button that generates the file and offers the download (link valid for a few minutes)" |

User prompt format (to adapt):

> Storage is in place on the server side ✅. For your users to actually be able to add and view their `<type provided>`, the visible part is missing - typically:
> - <bullet 1 adapted to the type>
> - <bullet 2>
> - …
>
> I can build all of this for you now, or do you prefer to do it yourself later?

**If yes**:
- Read `<storage_context>` (and the "R2 storage - context" section of the CLAUDE.md)
- Check whether add-db is in place - if so and `db_tracking = true`, create the appropriate table (e.g. `documents` with `owner_id`, `r2_key`, `name`, `mime_type`, `size`, `created_at`)
- **Detect whether i18n is active**: check the existence of `src/i18n/routing.ts`. If so, generate all the displayed text of the components via `useTranslations("storage")` (or another logical namespace) and add the FR + EN keys to each `messages/<locale>.json` as you go. Example keys: `"Choose a file"`, `"Drag and drop here"`, `"Uploading…"`, `"Error during upload"`, `"Delete"`, etc. Without active i18n, keep hard-coded strings in the user's language. The goal: prevent `/add-i18n` from having to retro-extract these strings later.
- Build the UI components with the project's style (read `globals.css` + available shadcn components in `~/components/ui/`):
  - **Upload component**: drag-drop or file picker, preview for images, progress bar, size/type validation
  - **tRPC procedure**: for private uploads, return a signed URL for direct upload to R2; for public ones, upload via the server then return the public URL
  - **Display**: Next.js `<Image>` for public images, `<a>` link or download button for private ones (with on-the-fly signed URL generation)
  - **Deletion (CRITICAL)**: if the UI allows **deleting** a file (a "Delete" button on a photo, removing a product, replacing an avatar…), the deletion tRPC procedure **must call `deleteObject(key)` on R2**, not just remove the database row. Pattern: delete the R2 object first (or in parallel), then the DB record; in case of R2 failure, log without blocking the DB deletion (but never skip the `deleteObject` call). For a cascade deletion (e.g. deleting a product = deleting its N photos), iterate `deleteObject` over all the keys. For a file **replacement**: upload the new one, update the reference, then `deleteObject` on the old key. Goal: zero orphaned object in the bucket (cost + GDPR).
  - **Security (private)**: auth check in the tRPC procedure (the user must be the owner or have the rights)
- Update the "## R2 storage - context" section of the CLAUDE.md with "UI: in place ✅"

**If no / later**:
- Mention it explicitly in the Step 10 Summary as a remaining manual action
- Do not mark "UI: in place" in the CLAUDE.md

## GDPR - Privacy policy

Add Cloudflare R2 to the project's GDPR subprocessor registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add cloudflare-r2
```

The helper is idempotent. If the `politique-de-confidentialite/page.tsx` page exists (created by `/bootstrap`), it updates automatically. Otherwise, only the registry is created - `/rgpd-audit` can generate the page later.

## Step 10 - Summary

Present to the user:

> ✅ **Cloudflare R2 storage configured.**
>
> **Bucket**: `<PROJECT_NAME>-assets` ([public - direct URL available | private - access via signed URLs])
> **Free tier**: 10 GB / month (more than enough to get started)

If UI built in Step 9:
> - 🎨 The interface to add and view your `<types>` is in place. You can test it on the relevant pages.

If UI skipped:
> - 🎨 **User interface not created** - when you are ready to add it, tell me *"add the upload feature"* and I will build the pages with the right design (the context is already noted in `CLAUDE.md` → "R2 storage - context").

If the user has not yet created the R2 credentials (Step 8):
> - 🔑 **Remaining manual step**: create the 2 R2 keys in the Cloudflare dashboard (instructions given above). Without these keys, no upload can work.
