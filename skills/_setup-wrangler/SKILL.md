---
name: _setup-wrangler
description: Internal helper to install and authenticate Wrangler (the Cloudflare CLI). Triggered automatically by /add-storage (and any other skill that needs Wrangler) when `wrangler --version` fails or when `wrangler whoami` reports the user is not logged in. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup Wrangler - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You install and authenticate Wrangler (the Cloudflare CLI) on the user's machine.

This is a one-time setup. Once done, Wrangler is available globally for all future Bootstrap projects on this machine.

---

## Step 1 - Verify current state

⚠️ **NEVER use `npx wrangler`.** It only finds wrangler in `node_modules/.bin` or npm cache, NOT in pnpm's global bin (`~/Library/pnpm` Mac, `~/.local/share/pnpm` Linux, `%LOCALAPPDATA%\pnpm` Windows). If the user installed wrangler via `pnpm add -g wrangler` (which is what this SKILL recommends in Step 2), `npx wrangler` will fail with "missing packages" even when wrangler IS installed and accessible via PATH or via direct path.

Use the wrangler env helper at the start to load the token from User scope (if not in process.env) and ensure pnpm bin is in PATH:

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
wrangler --version 2>/dev/null
wrangler whoami 2>/dev/null
```

Three possible cases:
- ✅ **Both succeed** → already set up. Tell the user "Wrangler is already installed and connected." and return to caller immediately.
- ⚠️ **Version OK, whoami fails** → installed but not logged in. Skip to Step 3.
- ❌ **Both fail** → not installed. Continue to Step 2.

## Step 2 - Install Wrangler

Tell the user:
> Wrangler (the Cloudflare CLI) is not installed. I'm going to install it globally with pnpm. It's quick.

Run:
```bash
pnpm add -g wrangler
```

Verify (re-run the env init after install since the binary path may now exist):
```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
wrangler --version
```

Expected: `⛅️ wrangler X.Y.Z`. If the install failed, investigate before continuing (often a permissions issue with the global pnpm bin folder).

## Step 3 - Authenticate

Tell the user:
> I'm now going to connect you to your Cloudflare account. A window will open in your browser - log in (or create an account if you don't have one yet) then approve the authorization. If you don't have a Cloudflare account yet, go to https://dash.cloudflare.com/sign-up.

Run:
```bash
wrangler login
```

This opens a browser for OAuth. Wait for the user to confirm in the terminal (Wrangler will print "Successfully logged in.").

⚠️ **Account mismatch warning** : if the user already had `wrangler` logged into a DIFFERENT Cloudflare account before `/start` and is now setting up a CLOUDFLARE_API_TOKEN for ANOTHER account, the env var will SILENTLY override the OAuth session (Wrangler prefers env var over OAuth). Check via `wrangler whoami` after login that the account matches the one the token was generated from. If mismatch, run `wrangler logout` first.

## Step 4 - Verify authentication

```bash
wrangler whoami
```

Should display the user's Cloudflare email and account ID. If not, the auth failed - re-run `wrangler login`.

## Step 5 - Done

Tell the user:
> ✅ Wrangler installed and connected. You won't have to do this step again for your future Bootstrap projects.

Return control to the calling skill (typically `/add-storage`).
