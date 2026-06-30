---
name: add-2fa
description: Add two-factor authentication (2FA TOTP) to an existing T3 project's login. Orchestrator - asks which authenticator app the user wants, detects whether the project uses admin auth (single fixed login) or user accounts, and delegates to the right setup. Admin mode - 2FA is mandatory for the single admin, secret + backup codes stored in the Bitwarden vault. User mode - 2FA is optional per user, each user enables it from their account page, secrets + backup codes stored per-user in the database. Requires the project to already have hypervibe auth (`/add-auth`).
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add 2FA - Orchestrator

Adds **two-factor authentication** (TOTP code from an authenticator app) to the project's login. This skill is an **orchestrator**: it asks which app to use, detects the auth mode, and delegates to the right sub-skill (hidden, prefixed with `_`):
- **Admin mode** (single login) → `_setup-2fa-admin`: 2FA mandatory, secret + codes in the **Bitwarden vault**.
- **User mode** (accounts) → `_setup-2fa-users`: 2FA **optional per user** (each one enables it from their account), secrets + codes **in the database** per user.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

---

## Step 0 - Detect the project

Invoke `_detect-project-root` → `PROJECT_NAME`, `WEB_DIR`, `IS_NEXTJS`. Abort if `IS_NEXTJS=no`.

---

## Step 1 - Detect the auth mode

Read the marker:

```bash
[ -f "<WEB_DIR>/src/server/auth.ts" ] && grep -E "^// hypervibe:auth-modes" "<WEB_DIR>/src/server/auth.ts" | head -1
```

- **No file / no marker** → **no auth installed**. 2FA needs an auth ; offer to install one (don't just stop). Explain:
  > Two-factor authentication sits **on top of** an authentication, and your project doesn't have one yet. I can install one now, then add 2FA right after.

  **Use the askUser tool**:
  > Do you want me to install an authentication first?
  - "Yes - an admin interface (a single protected login, for you)"
  - "Yes - user accounts (your visitors create an account)"
  - "No, not now"

  Depending on the answer:
  - **admin** or **users** → read and execute `add-auth` (telling it the chosen mode). Once it's done, **re-read the marker** (`grep` above), recompute `MODE`, and continue to Step 2.
  - **no** → stop cleanly ("OK, come back whenever: `/add-2fa` once the auth is in place").
- **Marker = `admin`** → `MODE = admin`.
- **Marker contains `users`** (`users` or `admin, users`) → `MODE = users`. (For `admin, users`, we handle the **user** 2FA: that's the flow that concerns the accounts; the optional admin login keeps its password.)
- **Already installed**: if `<WEB_DIR>/src/lib/auth-2fa.ts` (admin) or a per-user 2FA table already exists → say so and offer to regenerate rather than re-running.

---

## Step 2 - Ask for the authenticator app

**Use the askUser tool** (this is the first thing we ask):

> Which authenticator app do you want to use for the 6-digit codes?

Suggestions: "Google Authenticator", "Microsoft Authenticator", "Authy", "1Password (or another manager)".

Capture in `AUTH_APP`. TOTP is an open standard → the same QR works everywhere; the answer is used to tailor the final instructions. Don't block if the user names another one.

---

## Step 3 - Delegate to the right sub-skill

Pass `PROJECT_NAME`, `WEB_DIR`, `AUTH_APP` to the sub-skill:

- **`MODE = admin`** → read and execute `_setup-2fa-admin`.
- **`MODE = users`** → read and execute `_setup-2fa-users`.

The sub-skill handles everything (installation, secret security, summary). When it hands back, it's done - the orchestrator has nothing to add.
