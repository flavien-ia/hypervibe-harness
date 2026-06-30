---
name: add-github-auth
description: "Add GitHub OAuth login to an existing project. Guides through GitHub OAuth App setup and configures env vars automatically. Can be used standalone or called by /add-auth."
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add GitHub Auth - GitHub OAuth Configuration

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Adds GitHub OAuth authentication to an existing project. Can be used:
- **Standalone** (`/add-github-auth`) - on a project that already has NextAuth configured (via `/add-auth` or `/bootstrap`)
- **From `/add-auth`** - when the user picks GitHub as a provider

This skill walks the user step by step through the GitHub settings, then Claude Code takes over to configure the environment variables everywhere.

---

## Prerequisites

Before starting, identify:
- The project's local URL: `http://localhost:3000`
- The production URL (from Vercel or CLAUDE.md)
- The NextAuth callback URL: `<base_url>/api/auth/callback/github`

---

## Step 0 - Preflight: is NextAuth installed?

This skill requires NextAuth to already be in place (via `/add-auth` or `/bootstrap`). We check before sending the user into the GitHub configuration for nothing.

Invoke `_check-deps auth`:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" auth)
auth_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).auth.ok)")
auth_mode=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).auth.mode || 'unknown')")
```

**If `auth_ok = false`** (no `auth.ts` or no `AUTH_SECRET`) - abort with a simple message:

> ⚠️ Basic authentication is not in place yet in this project. First run `/add-auth` to set up email/password login, then come back to `/add-github-auth` to add GitHub login on top of it.

**If `auth_mode = "admin-credentials"`** - abort. GitHub OAuth does not apply to admin mode (where you are the only one logging in with a fixed password). Message to the user:

> Your project is configured in **admin-only** mode - only you log in via a fixed password. GitHub login is meant for a system where **your users** create accounts. So it is not compatible with your current setup.
>
> If you would rather switch to a user-accounts system (with GitHub as a bonus), you need to start over from `/add-auth`, this time choosing "system for your users".

**Otherwise** (`auth_mode = "user-credentials"`) → continue to Step 1.

---

## Step 1 - Create an OAuth App on GitHub

Show this message to the user:

> ### GitHub OAuth Configuration
>
> We are going to set up GitHub authentication together. I will guide you through the GitHub settings, and I will take care of configuring everything on the code and Vercel side afterwards.
>
> **1. Open the GitHub developer settings:**
> Go to [github.com/settings/developers](https://github.com/settings/developers)
>
> (You can also get there via: GitHub → your avatar in the top right → **Settings** → **Developer settings** at the very bottom of the left menu)
>
> **2. Create a new OAuth App**:
> - Click **"OAuth Apps"** in the left menu
> - Click **"New OAuth App"** (or **"Register a new application"**)
>
> **3. Fill in the form**:
> - **Application name**: the name of your app (e.g. `My App`)
> - **Homepage URL**: `https://<production_url>`
> - **Application description**: optional, a short description of your app
> - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`
>
> ⚠️ We use the local URL for now. We will add the production URL afterwards.
>
> **4. Click "Register application"**
>
> Let me know when it is done.

Replace `<production_url>` with the project's real URL before displaying.

Wait for the user's confirmation before continuing.

---

## Step 2 - Get the Client ID and generate the Client Secret

Show this message:

> ### Get the credentials
>
> You should now be on your OAuth App's page.
>
> **5. Client ID**:
> - The **Client ID** is displayed directly on the page (a string of ~20 characters)
>
> **6. Generate the Client Secret**:
> - Click **"Generate a new client secret"**
> - GitHub shows the secret only once - **copy it immediately**
> - ⚠️ If you leave the page without copying it, you will have to generate a new one
>
> **Send me the Client ID and the Client Secret** and I will take care of configuring everything.

Wait for the user to provide the Client ID and the Client Secret.

---

## Step 3 - Claude Code configures everything

Once both values are received:

### 3a. Push the env vars

Invoke `_push-env-vars` with:
- `AUTH_GITHUB_ID=<provided_client_id>`
- `AUTH_GITHUB_SECRET=<provided_client_secret>`

The helper writes to the local `.env` AND pushes to Vercel (production/preview/development) idempotently.

### 3b. Configure the provider in NextAuth

In `src/server/auth.ts`, make sure the GitHub provider is configured:

```typescript
import GitHubProvider from "next-auth/providers/github";

// In the providers config:
GitHubProvider({
  clientId: process.env.AUTH_GITHUB_ID!,
  clientSecret: process.env.AUTH_GITHUB_SECRET!,
}),
```

### 3c. Add the "Continue with GitHub" button on the signin/signup pages

Invoke `_detect-project-root` to get `WEB_DIR`, then run the helper that patches the auth pages:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-oauth-button.mjs" \
  --web-dir "$WEB_DIR" \
  --provider github
```

The script:
- Detects `src/app/signin/page.tsx` and `src/app/signup/page.tsx` (or their equivalents under `[locale]/` if i18n is active), and inserts a "Continue with GitHub" button + an "or" separator below the email/password submit button
- Is idempotent: if `signIn("github"` is already present in the page, it touches nothing; if an OAuth block already exists (Google added before), it stacks GitHub into it without duplicating the separator
- Automatically detects whether the page uses `useTranslations` (i18n variant) or hardcoded FR strings (plain variant), and writes the appropriate snippet
- If i18n is active, adds the keys `signin.orSeparator`, `signin.continueWithGithub`, `signup.orSeparator`, `signup.continueWithGithub` to the `messages/<locale>.json` files

Without this step, the GitHub provider would technically be configured on the server side but no button would be visible - the user would have to go through `/api/auth/signin` (NextAuth's fallback page) to use it.

### 3d. Update CLAUDE.md

Invoke `_update-claude-md` with:
- `conventions`: `- **OAuth GitHub** : callback URL = \`https://<production_url>/api/auth/callback/github\``

---

## Step 4 - Add the production callback URL

Show this message:

> ### Add the production URL
>
> Last manual step! You need to add the production callback URL in your GitHub OAuth App.
>
> **7. Go back to your OAuth App's page**:
> [github.com/settings/developers](https://github.com/settings/developers) → click on your app's name
>
> **8. Edit the Authorization callback URL**:
> - Replace the current URL (`http://localhost:3000/api/auth/callback/github`)
> - With the production URL: `https://<production_url>/api/auth/callback/github`
>
> **9. Click "Update application"**
>
> **💡 Tip**: GitHub supports only **one callback URL** per OAuth App. For local dev to work too, two options:
> - **Option A (recommended)**: create a **second OAuth App** dedicated to local dev (callback = `http://localhost:3000/api/auth/callback/github`) and use its credentials in the local `.env`
> - **Option B**: switch the URL in the GitHub settings depending on whether you are testing locally or in prod
>
> Let me know if you want me to help you create a second OAuth App for local dev.

Replace `<production_url>` with the project's real URL before displaying.

---

## RGPD - Privacy policy

Add GitHub to the project's RGPD subprocessor registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add github-oauth
```

The helper is idempotent. If the `politique-de-confidentialite/page.tsx` page exists, it updates automatically. Otherwise, only the registry is created - `/rgpd-audit` can generate the page later.

---

## Step 5 - Verification

Confirm to the user that everything is configured:

- `.env` updated with `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`
- Variables pushed to Vercel (production + preview + development)
- GitHub provider configured in `src/server/auth.ts`
- CLAUDE.md updated

Remind them that:
- Locally, test with `pnpm dev` then go to `/signin` - the "Continue with GitHub" button should appear below the email/password form
- GitHub OAuth has no test mode - any GitHub user can log in immediately
- If the user wants to restrict access, they must handle that on the application side (whitelist, roles, etc.)
