---
name: add-google-auth
description: "Add Google OAuth login to an existing project. Guides through Google Cloud Console setup and configures env vars automatically. Can be used standalone or called by /add-auth."
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add Google Auth - Google OAuth Configuration

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Adds Google OAuth authentication to an existing project. It can be used:
- **Standalone** (`/add-google-auth`) - on a project that already has NextAuth configured (via `/add-auth` or `/bootstrap`)
- **From `/add-auth`** - when the user chooses Google as the provider

This skill walks the user step by step through the Google Cloud Console, then Claude Code takes over to configure the environment variables everywhere.

---

## Prerequisites

Before starting, identify:
- The project's local URL: `http://localhost:3000`
- The production URL (from Vercel or CLAUDE.md, typically `NEXT_PUBLIC_APP_URL`)
- The NextAuth callback URL: `<base_url>/api/auth/callback/google`

### Recommendation: configure the final domain BEFORE

**Ideally, run `/add-google-auth` AFTER configuring the final domain via `/add-domain`.** Otherwise the OAuth URLs will point to `https://<project>.vercel.app`, and you will have to come back into the Google Cloud Console later to **add** (not replace) the new custom-domain URLs.

Check `NEXT_PUBLIC_APP_URL`:
- **If it points to a `.vercel.app`** -> warn the user and offer them: (a) do `/add-domain` first (recommended), or (b) continue with the Vercel URL and come add the custom URLs later.
- **If it points to a custom domain** -> continue.

---

## Step 0 - Preflight: is NextAuth installed?

This skill requires that NextAuth is already in place (via `/add-auth` or `/bootstrap`). We check before sending the user into the Google Cloud Console for nothing.

Invoke `_check-deps auth`:

```bash
result=$(node "${CLAUDE_SKILL_DIR}/../../scripts/check-deps.mjs" auth)
auth_ok=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).auth.ok)")
auth_mode=$(echo "$result" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).auth.mode || 'unknown')")
```

**If `auth_ok = false`** - abort with a simple message:

> ⚠️ Basic authentication is not yet in place in this project. First run `/add-auth` to set up email/password login, then come back to `/add-google-auth` to add Google login on top.

**If `auth_mode = "admin-credentials"`** - abort. Google OAuth does not apply to admin mode:

> Your project is configured in **admin-only** mode - only you log in via a fixed password. Google login is for a system where **your users** create accounts. It is therefore not compatible with your current setup.
>
> If you would rather switch to a user-accounts system (with Google as a bonus), you need to start over from `/add-auth` and this time choose "system for your users".

**Otherwise** (`auth_mode = "user-credentials"`) -> continue to Step 1.

---

## Step 1 - Create or select a Google Cloud project

Show this message to the user:

> ### Google OAuth Configuration
>
> We are going to configure Google authentication together. I will guide you through the Google console, and I will take care of configuring everything on the code and Vercel side afterwards.
>
> **1. Open the Google Cloud Console:**
> Go to [console.cloud.google.com](https://console.cloud.google.com)
>
> **2. Create a new project** (or select an existing project):
> - At the top of the page, click the **project selector** (to the right of the "Google Cloud" logo)
> - Click **"New project"**
> - **Project name**: enter the name of your app (e.g. `my-app`)
> - **Organization**: leave the default or choose yours
> - Click **"Create"**
> - Wait a few seconds, then select the newly created project in the selector
>
> Let me know when it's done.

Wait for the user's confirmation before continuing.

---

## Step 2 - Configure Google Auth Platform

⚠️ **Important note about the Google Cloud UI**: since 2026, Google has replaced the old "OAuth consent screen" with **"Google Auth Platform"**, which brings the OAuth config and the clients together in a unified interface. The flow below reflects the new UI. If you still see the old UI (rare), look for the equivalent labels.

### 2.a - Launch the "Get started" wizard

Show this message:

> **3. In the left menu**, go to **"APIs and services"** > **"OAuth consent screen"** (the URL is still that one, but it now takes you to **Google Auth Platform**).
>
> (If you don't see the menu, click the **hamburger menu ☰** at the top left.)
>
> **4.** You land on a "Google Auth Platform not configured yet" screen. Click the blue **"Get started"** button in the center.
>
> **5.** A multi-step wizard opens. Fill it in as follows:
>
> - **App information**:
>   - **App name**: the name shown to users when they log in (e.g. `<APP_NAME>`)
>   - **User support email**: your email
>   - Click **"Next"**
>
> - **Audience** *(this is the name used IN THE WIZARD for what used to be called "User type" - note that in the left sidebar, the same concept is called "Audience")*:
>   - Select **"External"** (lets any Google account log in)
>   - Click **"Next"**
>
> - **Contact information** *(just "Contact information", not "Developer contact information")*:
>   - **Email addresses**: your email
>   - Click **"Next"**
>
> - **Terms of service**: check the only box present (acceptance of the Google API policies) and click **"Continue"**.
>
> **6.** On the final confirmation screen, click **"Create"** to finalize the Google Auth Platform configuration.
>
> Let me know when it's done.

Wait for the user's confirmation before continuing.

### 2.b - Add the scopes ("Data access" section)

Once Google Auth Platform is configured, we add the necessary scopes separately:

> **7. In the left sidebar**, click **"Data access"**.
>
> **8.** Click **"Add or remove scopes"**.
>
> **9.** In the right-hand panel that opens, check the **two minimal scopes** needed to identify a user:
> - `.../auth/userinfo.email`
> - `.../auth/userinfo.profile`
>
> (Don't check **anything else** - the minimum is enough, and the more scopes you request, the more justifications Google will ask for when you go to production.)
>
> **10.** Click **"Update"**.
>
> Let me know when it's done.

Wait for the user's confirmation before continuing.

### 2.c - Add test users ("Audience" section)

While the app is in test mode, only explicitly listed users can log in via Google. We add them now:

> **11. In the left sidebar**, click **"Audience"** *(here it really is "Audience", not "Target" - Google uses both words depending on context: "Target" in the initial wizard, "Audience" in the sidebar)*.
>
> **12.** You see a **"Test users"** section. Click **"+ Add users"**.
>
> **13.** Add your Gmail address (and those of the other people you want to allow to test). You can add up to 100. Confirm.
>
> Let me know when it's done.

Wait for the user's confirmation before continuing.

---

## Step 3 - Create the OAuth credentials ("Clients" section)

⚠️ In the new Google Auth Platform UI, what used to be called "APIs and services > Credentials" is now **"Clients"** in the left sidebar of Google Auth Platform. It's the same mechanism, just a new path.

Build the list of URIs before showing the message:

- JS origins: `http://localhost:3000` + `https://<production_url>` (and optionally the original Vercel URL `https://<project>.vercel.app` as a test fallback if a custom domain is wired up)
- Redirect URIs: `<origin>/api/auth/callback/google` for each of the origins above

Show this message:

> ### Create the OAuth credentials
>
> **14. In the left sidebar** of Google Auth Platform, click **"Clients"**.
>
> **15.** Click **"+ Create client"** (or "+ Create client" depending on your interface language).
>
> **16. Configure the OAuth client**:
> - **Application type**: select **"Web application"**
> - **Name**: `<APP_NAME>` (this is an internal name to help you find it on Google's side, not seen by users)
>
> **17. Authorized JavaScript origins** - click **"+ Add URI"** for each:
> - `http://localhost:3000`
> - `https://<production_url>`
> - *(Optional)* `https://<project>.vercel.app` - useful as a test fallback if you have already wired up a custom domain and you want to keep the original Vercel URL accessible
>
> **18. Authorized redirect URIs** - click **"+ Add URI"** for each:
> - `http://localhost:3000/api/auth/callback/google`
> - `https://<production_url>/api/auth/callback/google`
> - *(Optional)* `https://<project>.vercel.app/api/auth/callback/google`
>
> ⚠️ **Mind the exact path**: it's `/api/auth/callback/google` (with `api`, `auth`, `callback`, `google` in that order). Not `/auth/callback/google`, nor `/api/auth/google`, nor `/callback/google` - NextAuth requires this precise format.
>
> ℹ️ **If `<production_url>` is still a Vercel URL** (e.g. `my-app.vercel.app`, no custom domain yet): that's OK to get started. **When you connect a real domain name later** (via `/add-domain`), you will need to come back to this screen and **ADD** (without removing the old URLs - that lets you keep Vercel as a fallback):
> - JS origin: `https://your-domain.com`
> - Redirect URI: `https://your-domain.com/api/auth/callback/google`
>
> **19. Click "Create"**
>
> **20. Copy the credentials**:
> A popup appears with:
> - **Client ID** (format `123456789-xxxxxx.apps.googleusercontent.com`)
> - **Client secret** (a random string that often begins with `GOCSPX-`)
>
> **Send me these two values** and I will take care of configuring everything on the code + Vercel side.

Replace `<production_url>`, `<project>` and `<APP_NAME>` with the real values of the current project before showing.

Wait for the user to provide the Client ID and the Client Secret.

---

## Step 4 - Claude Code configures everything

Once the two values are received:

### 4a. Push the env vars

Invoke `_push-env-vars` with:
- `AUTH_GOOGLE_ID=<provided_client_id>`
- `AUTH_GOOGLE_SECRET=<provided_client_secret>`

The helper writes to the local `.env` AND pushes to Vercel (production/preview/development) idempotently (removes the old values before adding).

### 4b. Configure the provider in NextAuth

In `src/server/auth.ts`, make sure the Google provider is configured:

```typescript
import GoogleProvider from "next-auth/providers/google";

// In the providers config:
GoogleProvider({
  clientId: process.env.AUTH_GOOGLE_ID!,
  clientSecret: process.env.AUTH_GOOGLE_SECRET!,
}),
```

### 4c. Add the "Continue with Google" button on the signin/signup pages

Invoke `_detect-project-root` to get `WEB_DIR`, then run the helper that patches the auth pages:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-oauth-button.mjs" \
  --web-dir "$WEB_DIR" \
  --provider google
```

The script:
- Detects `src/app/signin/page.tsx` and `src/app/signup/page.tsx` (or their equivalents under `[locale]/` if i18n is active), and inserts a "Continue with Google" button + an "or" separator below the email/password submit button
- Is idempotent: if `signIn("google"` is already present in the page, it touches nothing; if an OAuth block already exists (another provider was added before), it stacks the new button inside it without duplicating the separator
- Automatically detects whether the page uses `useTranslations` (i18n variant) or hardcoded FR strings (plain variant), and writes the appropriate snippet
- If i18n is active, adds the keys `signin.orSeparator`, `signin.continueWithGoogle`, `signup.orSeparator`, `signup.continueWithGoogle` to the `messages/<locale>.json` files (FR/EN translated, other locales with EN values to be refined manually)

Without this step, the Google provider would technically be configured on the server side but no button would be visible - the user would have to go through `/api/auth/signin` (NextAuth's fallback page) to use it.

### 4d. Update CLAUDE.md

Invoke `_update-claude-md` with:
- `conventions`:
  - `- **Google OAuth**: callback URL = \`https://<production_url>/api/auth/callback/google\``
  - `- Google Cloud Console project: \`<google_project_name>\`` (ask the user if not known)
  - `- **When you change NEXT_PUBLIC_APP_URL** (e.g. moving from a Vercel URL to a custom domain via \`/add-domain\`): you MUST go to Google Cloud Console > APIs and services > Credentials > <oauth_client_name> and **ADD** the new JavaScript origin + the new redirect URI (\`https://<new_domain>/api/auth/callback/google\`). Don't remove the old URLs (the Vercel URL stays useful as a test fallback). Otherwise, Google login breaks in production with the error \`redirect_uri_mismatch\`.`

---

## Step 5 - Publishing the Google app (optional)

Show this message:

> ### Publishing mode
>
> Your Google app is currently in **test mode**. That means:
> - Only the users added in the **"Audience > Test users"** section (Step 2.c) can log in
> - The consent screen shows a warning "Google hasn't verified this app"
> - Maximum 100 test users
>
> **This is perfect for development and the first tests.**
>
> When you are ready to open access to everyone:
> 1. Go to **Google Auth Platform > Audience** (in the left sidebar)
> 2. Click **"Publish app"**
> 3. If you only use the `email` and `profile` scopes, **no Google verification needed** - going to production is immediate
> 4. If you use sensitive scopes, Google will require a verification (which can take a few days/weeks)

---

## RGPD - Privacy policy

Add Google to the project's RGPD subprocessors registry:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add google-oauth
```

The helper is idempotent. If the `politique-de-confidentialite/page.tsx` page exists, it updates automatically. Otherwise, only the registry is created - `/rgpd-audit` will be able to generate the page later.

---

## Step 6 - Verification

Confirm to the user that everything is configured:

- `.env` updated with `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`
- Variables pushed to Vercel (production + preview + development)
- Google provider configured in `src/server/auth.ts`
- CLAUDE.md updated

Remind them that:
- Locally, test with `pnpm dev` then go to `/signin` - the "Continue with Google" button should appear below the email/password form
- The Google app is in test mode - only test users can log in for now
- To go to production, follow the instructions in Step 5
