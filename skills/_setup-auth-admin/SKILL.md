---
name: _setup-auth-admin
description: Internal helper - sets up NextAuth in admin-credentials mode (fixed login via env vars, no DB, no OAuth). Invoked by add-auth when the user chose the "admin-only interface" option. Installs NextAuth core, configures the CredentialsProvider with a single hardcoded admin, generates dev + prod password hashes, adds rate limiting on login, and pushes env vars. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup Auth - Admin-credentials mode

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Installs NextAuth in **admin mode**: a single admin account whose credentials live in the env vars (no DB). Invoked by `add-auth` when the user chose "Just a protected admin interface".

The deterministic code (install, AUTH_SECRET generation, dev+prod hashes, scaffold `auth.ts` / `password.ts` / API route, scaffold pages `/admin/signin` + `/admin` (protected route group), push env vars) lives in `scripts/setup-auth-admin.mjs`. This SKILL only handles the pre-flight (passed by `add-auth`), the script invocation, and the post-script communication (display the prod password once + CLAUDE.md).

**Input variables** (passed by `add-auth`): `WEB_DIR`, `IS_MONOREPO`, `PROJECT_NAME`.

⚠️ **Fresh install only** - the script refuses if `src/server/auth.ts` already exists. The "add admin on top of existing users-credentials" case is driven by Claude from `add-auth` Step 0, NOT by this skill.

---

## Step 1 - Run the script

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-auth-admin.mjs" \
  --name "<PROJECT_NAME>" \
  --web-dir "<WEB_DIR>"
```

The script chains 9 sub-steps: preflight, install next-auth@beta, AUTH_SECRET generation, dev hash (`Admin1234!`) + prod generation (24 alphanumeric chars) + hash, write `src/lib/password.ts`, write `src/server/auth.ts` (marker `// hypervibe:auth-modes admin`), write API route with rate limiting, write admin pages (`src/app/admin/signin/page.tsx` + `src/app/admin/(protected)/{layout,page}.tsx` - route group that isolates the gate from the signin to avoid the redirect loop), push env vars (AUTH_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH_DEV, ADMIN_PASSWORD_HASH_PROD, target=all).

### During execution

The script prints live:
- `▸ <step>` when it starts each sub-step
- `✅ <result>` at the end
- `⚠️ <warning>` (notably if `src/lib/rate-limit.ts` is absent - bootstrap is supposed to create it; the warning is non-blocking but the TS build will fail as long as `rate-limit.ts` does not exist)
- At the end, a structured **handoff banner**
- On the last line on success, a parseable JSON object:
  ```json
  {"success":true,"authMode":"admin","prodPassword":"<plain-24-chars>","envVars":["AUTH_SECRET","ADMIN_USERNAME","ADMIN_PASSWORD_HASH_DEV","ADMIN_PASSWORD_HASH_PROD"]}
  ```

⚠️ The `prodPassword` is **sensitive**: it is stored nowhere (only the hash is). You MUST display it ONCE to the user in the summary (Step 3) and never reuse it afterward.

### On success

Mark the step ✅, capture `prodPassword` from the JSON, and move on to Step 2.

### On failure

1. Read the error just above the handoff banner.
2. Identify the failed step (`❌ Failed at: <step>`). The name maps 1:1 to a function in the script - open `setup-auth-admin.mjs` and look at the function.
3. Diagnose:
   - `preflight` failed → usually `src/server/auth.ts` already exists (re-config), or one of the pages `src/app/admin/signin/page.tsx` / `src/app/admin/(protected)/{layout,page}.tsx` already exists → go back to the Step 0 menu of `add-auth`. Or `package.json` missing / no Next.js.
   - `installNextAuth` failed → pnpm / network error → retry manually.
   - `hashPasswords` failed → often `hash-password.mjs` not found (sibling script absent) or Node too old. Diagnose with `node "$CLAUDE_SKILL_DIR/../../scripts/hash-password.mjs" --help`.
   - `writeAuthTs` / `writePasswordTs` / `writeApiRoute` / `writeAdminPages` failed → filesystem permission (rare) or missing template.
   - `pushEnvVars` failed → all the code is in place, only the env vars did not land → re-run `_push-env-vars` manually with the values visible in the logs.
4. Continue the remaining steps manually.

---

## Step 2 - Update CLAUDE.md

Invoke `_update-claude-md` with:

- `stack`: `- **Auth**: NextAuth v5 (admin mode - single account via env vars)`
- `conventions`:
  - `- Auth admin: \`await isAdmin()\` from \`~/server/auth\` to check access. Session via \`await auth()\`.`
  - `- **Admin structure**: route group \`src/app/admin/(protected)/\` which contains the pages to protect (gate in its \`layout.tsx\` via \`if (!await isAdmin()) redirect("/admin/signin?callbackUrl=/admin")\`). \`src/app/admin/signin/page.tsx\` stays outside the group to avoid the redirect loop. Any new admin page goes in \`(protected)/\`. NEVER add a gate in \`app/admin/layout.tsx\` (this layout also wraps signin → infinite loop).`
- `custom`:
  - heading: `## Changing the admin password in production`
  - body:
    ```
    Admin auth uses `ADMIN_PASSWORD_HASH_DEV` (dev) and `ADMIN_PASSWORD_HASH_PROD` (prod), selected via NODE_ENV.
    To change it: `printf '%s' "<new-password>" | node "<path>/scripts/hash-password.mjs"` (output = `salt:hash`), then `_push-env-vars ADMIN_PASSWORD_HASH_PROD=<salt:hash>`.
    To generate a new random password AND hash it: `node "<path>/scripts/hash-password.mjs" --generate --length 24 --format alphanumeric` (2-line output: `password=<plain>` + `hash=<salt:hash>`).
    ```
- `env-vars`:
  - `- \`AUTH_SECRET\` - NextAuth session secret`
  - `- \`ADMIN_USERNAME\` - admin login name (default: admin)`
  - `- \`ADMIN_PASSWORD_HASH_DEV\` - scrypt hash of the dev admin password (Admin1234!)`
  - `- \`ADMIN_PASSWORD_HASH_PROD\` - scrypt hash of the prod admin password (unique per project)`

---

## Step 3 - Summary for the user

Display exactly (replacing `<PROD_PASSWORD>` with the value read from the `prodPassword` JSON of Step 1):

> ## ✅ Your admin interface is ready
>
> You are the only one who can sign in. Here are your credentials:
>
> **Locally (on your computer during development)**:
> - Username: `admin`
> - Password: `Admin1234!`
>
> **In production (on your live site)**:
> - Username: `admin`
> - Password: `<PROD_PASSWORD>`
>
> ⚠️ **Save the production password in your password manager right now** - it is stored nowhere else, only a hash (an unreadable version) is kept. If you lose it, you will have to generate a new one.
>
> **How to use it**: go to `/admin/signin` and sign in. You will be redirected to `/admin`, your admin space (which for now just contains a welcome message and a sign-out button). Ask me whenever you want *"add an admin page to manage X"* - I will create the pages directly in the right folder (`src/app/admin/(protected)/...`) with the protection already in place.

If the script reported warnings (e.g. `rate-limit.ts` absent), mention it here.

**Do not reuse the `<PROD_PASSWORD>` value** after this display. It disappears from your memory context as of this step.
