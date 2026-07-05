---
name: start
description: First-time onboarding for Hypervibe. Checks that all prerequisites are installed (CLIs, accounts, auth), explains what the plugin does, and guides toward the first /bootstrap. Use when someone installs the plugin for the first time.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Start - First-time use

You are welcoming a new Hypervibe user. Your role is to verify that everything is in place, install what is missing, and guide them toward their first project.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

---


## Step 1 - Welcome + OS detection

Display the welcome message, then silently detect the OS:

```bash
uname -s 2>/dev/null || echo "Windows"
```

- Result `Darwin` → **macOS** → store `OS=mac`
- Result containing `MINGW`, `MSYS`, or `Windows` → **Windows** → store `OS=windows`
- Result `Linux` → **Linux** → store `OS=linux`

> **Welcome to Hypervibe!**
>
> This plugin lets you build complete web applications in just a few minutes. You describe what you want, and I build it.
>
> First, I will check your environment and install what is missing.

**All the following steps adapt based on the detected OS.**

---

## Step 2 - Silent audit

Run **all** these checks in parallel, silently:

```bash
node --version 2>/dev/null
pnpm --version 2>/dev/null
git --version 2>/dev/null
gh --version 2>/dev/null
gh auth status 2>/dev/null
vercel --version 2>/dev/null
vercel whoami 2>/dev/null
wrangler --version 2>/dev/null
wrangler whoami 2>/dev/null
```

> **Note**: no more Resend CLI or MCP connector (Hostinger, GSC, Neon) to audit. These services now go through their REST API with a key stored in the **vault** (Bitwarden). The vault is set up in Step 3, and the cross-cutting keys (Cloudflare, Neon, email) are collected in Steps 4 and 7.

### Cloudflare token (stored in the vault)

Cloudflare is used by 4 add-ons (`/add-domain`, `/add-email`, `/add-cron`, `/add-storage`). A single API token, now **stored in the vault** (item `CLOUDFLARE`, field `api_token`). `wrangler` reads it on the fly (helper `wrangler-env-init.mjs`).

Check whether it is present (only if the vault is already unlocked, otherwise we collect it in Step 4):
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get CLOUDFLARE api_token >/dev/null 2>&1 && echo "présent" || echo "à configurer (Étape 4)"
```

### Neon
The Neon API key is **stored in the vault** (item `NEON`, field `api_key`), collected in Step 7. Provisioning + SQL via REST API / helper `run-sql.mjs`.

Classification of each tool: ✅ installed+connected · ⚠️ installed without login · ❌ not installed.

---

## Step 3 - Automatic installation of the foundations

⚠️ **Install Node.js, Git, and pnpm automatically, without asking, directly via bash. Do NOT create a script for this step.**

The CLIs (GitHub, Vercel, Wrangler) are never installed here. They are offered in Step 4 after confirmation.

### Windows

**Check winget** (needed to install Node.js and Git):
```bash
winget --version 2>/dev/null
```
If winget is not available, install it automatically via PowerShell:
```bash
powershell.exe -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/microsoft/winget-cli/releases/latest/download/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle' -OutFile \"$env:TEMP\\winget.msixbundle\"; Add-AppxPackage -Path \"$env:TEMP\\winget.msixbundle\""
```
Re-check with `winget --version`. If it fails, inform the user:
> The automatic installation of winget failed. Install it manually: https://aka.ms/getwinget (App Installer in the Microsoft Store). Then re-run `/start`.

**Do not continue without winget.**

**Node.js** (if missing):
```bash
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements 2>&1
```
After the install, force the PATH update in the current bash session:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
```

**Git** (if missing):
```bash
winget install Git.Git --accept-package-agreements --accept-source-agreements 2>&1
```

**pnpm** (if missing):
```bash
npm install -g pnpm
```

### macOS

**Homebrew** (if missing):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

⚠️ **Right after the install, `brew` is NOT on the shell PATH** (Apple Silicon installs it in `/opt/homebrew`, Intel in `/usr/local`). **Before any `brew` command**, put it on the PATH, for the current session AND future ones (zsh = macOS default). Do it **in the same block** as the install (shell variables do not persist between commands):

**Node.js + Git** (if missing):
```bash
# resolve brew by absolute path (PATH not yet refreshed)
BREW=$([ -x /opt/homebrew/bin/brew ] && echo /opt/homebrew/bin/brew || echo /usr/local/bin/brew)
# persist for future shells
grep -q "brew shellenv" ~/.zprofile 2>/dev/null || echo 'eval "$('"$BREW"' shellenv)"' >> ~/.zprofile
# activate in the current session + install
eval "$("$BREW" shellenv)" && brew install node git
```

**pnpm** (if missing):
```bash
npm install -g pnpm
```

### Post-install verification

```bash
node --version && npm --version && pnpm --version
```

If an installation fails, display the exact error and stop.

### Pnpm global bin in the PATH (cross-platform, idempotent)

`pnpm` installs the global CLIs (`pnpm add -g <cli>`) in a dedicated folder (`%LOCALAPPDATA%\pnpm` on Windows, `~/Library/pnpm` on macOS, `~/.local/share/pnpm` on Linux). This folder must be on the PATH so that `vercel`, `wrangler`, `neonctl`, etc. are callable without an absolute path. But `npm install -g pnpm` (Step 3) installs the latest available version of pnpm without configuring the PATH. A separate `pnpm setup` is needed. Without it, every skill that runs `vercel --version` hits `command not found` and wastes 5-10 lines diagnosing it (seen in prod 2026-05-02).

Run this script. It wraps `pnpm setup`, which is the canonical cross-platform command to configure PNPM_HOME + PATH (User registry on Windows, `~/.zshrc` or `~/.bashrc` on Unix). Idempotent: re-running is a no-op if already configured.

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ensure-pnpm-globalbin.mjs"
```

Expected output:
- `OK` (normal case) → say nothing to the user, continue silently.
- `ERROR: <reason>` → briefly mention it to the user in the final report (do not block; the pnpm CLIs will be usable after a manual `pnpm setup`).

⚠️ **For the current terminal**: `pnpm setup` modifies the PATH at the shell rc / registry level, not the running process. If a pnpm-installed command must be run RIGHT NOW (before restarting the terminal), Claude can do an `export PATH` at the start of the Bash:
- Windows: `export PATH="$PATH:/c/Users/$USER/AppData/Local/pnpm"`
- macOS: `export PATH="$PATH:$HOME/Library/pnpm"`
- Linux: `export PATH="$PATH:$HOME/.local/share/pnpm"`

### Gitleaks - machine-wide secret-leak protection (cross-platform, idempotent)

Gitleaks scans the staged diff on every `git commit` and blocks the commit if a secret pattern is detected (API keys, tokens, connection strings, JWT, etc.). We install it **once at the machine level**: binary in the user PATH, global git hook, shared config. All repos (past, present, future) benefit from it automatically, without committing anything into the projects. Important when working with LLMs and frequently copy-pasting `.env` files.

Run this script (cross-platform, idempotent - Windows / macOS / Linux):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-gitleaks-global.mjs"
```

The script:
- Downloads the official gitleaks binary from GitHub releases (latest, ~10 MB)
- Installs it in `%LOCALAPPDATA%\gitleaks` (Windows) or `~/.local/bin` (Mac/Linux)
- Adds it to the User PATH **without ever using `setx PATH`** (PowerShell `[Environment]::SetEnvironmentVariable` on Windows, line added to `~/.zshrc` or `~/.bashrc` on Mac/Linux)
- Creates `~/.git-hooks/pre-commit` which invokes gitleaks on the staged files
- Creates `~/.gitleaks.toml` with a Hypervibe-friendly allowlist (`.env.example` placeholders, lockfiles, fixtures, etc.)
- Configures `git config --global core.hooksPath` with the right format depending on the OS

Expected output (on stdout, 1 line):
- `OK` → already installed + configured, say nothing to the user, continue
- `INSTALLED` → first setup successful, mention in the final report (Step 4): "Secret-leak protection enabled across the whole machine"
- `ERROR: <reason>` → mention it to the user, non-blocking (commits will continue without this protection)

⚠️ **Track the status in `STATUS_GITLEAKS`** (mental variable) to pass it as a flag in Step 9 (`--with-gitleaks` to `update-global-claude-md.mjs`).

---

## Step 3bis - Key vault (Bitwarden) - MANDATORY

The encrypted vault keeps the participant's cross-cutting keys (Cloudflare, Neon, email) off the disk in plaintext. We set it up BEFORE collecting these keys (Steps 4, 7, and 7bis).

**Install the `bw` tool** (idempotent):
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/install-bw.mjs"
```
- `OK` → already there. `INSTALLED…` → installed (export the PATH for the session: `export PATH="$PATH:$HOME/.hypervibe/bin"`). `ERROR:` → report it, non-blocking.

**Check the vault state**:
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status 2>/dev/null
bw status 2>/dev/null
```
- `unlocked` → vault already ready, move on to Step 4.
- `bw status` = `unauthenticated` (no connected account) → **immediately launch the `_add-keyring` skill by default, WITHOUT asking for confirmation**: the vault is MANDATORY, there is nothing to decide. NEVER ask a question like "do you want to set up your vault now?", do not wait for confirmation: go straight to `_add-keyring`, which guides the creation of the Bitwarden account (free, master password to write down offline, 2FA), the login, and the first unlock. Non-technical language.
- `locked`/`expired` (account connected but vault closed) → open it: `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock` (blocking).

> **Your key vault**: an encrypted place where I store your access keys (database, email, hosting, etc.). You type your master password once a day, and after that I use it without you having to copy anything over. ⚠️ This master password cannot be recovered by anyone. Write it down offline.

Re-confirm `vault.mjs status` = `unlocked` before continuing.

---

## Step 4 - Report and proposal

Present a clear report:

> **Your environment:**
>
> ✅ Node.js - vX.X.X
> ✅ pnpm - vX.X.X
> ✅ Git - vX.X.X
> ❌ GitHub CLI - not installed
> ❌ Vercel CLI - not installed
> ❌ Wrangler CLI - not installed
> 🔒 Vault - ready / to configure
> 🔑 Cloudflare / Neon / Resend (vault keys), to collect (Steps 4, 7, and 7bis)

### Cloudflare token (to do BEFORE the CLIs script)

⚠️ The Cloudflare token must be configured **before** running the CLIs script, because `wrangler` detects the env var at install/usage time. If the token is missing or invalid, ask first:

> For Cloudflare, I need an **API token** (a single one, used for DNS, Workers, R2, and Email Routing). Here is how to generate it for me in 2 minutes:
>
> **0. First, log in to Cloudflare**
> Go to **https://dash.cloudflare.com** - if you do not have an account, create one (free, ~1 min). Otherwise, log in.
>
> **1. Generate the token**
> Once logged in, go to **https://dash.cloudflare.com/profile/api-tokens**
>
> 2. Click **"Create Token"** → **"Create Custom token"** → **"Get started"**
> 3. **Token name**: `Claude Code`
> 4. **Permissions** (click "+ Add more" for each additional line):
>    - Account · Workers Scripts · Edit
>    - Account · Workers R2 Storage · Edit
>    - Account · Workers AI · Read
>    - Account · Email Routing Addresses · Edit
>    - Account · Account Settings · Read
>    - Account · Account Analytics · Read
>    - User · User Details · Read
>    - User · Memberships · Read
>    - Zone · Zone · Edit
>    - Zone · DNS · Edit
>    - Zone · Email Routing Rules · Edit
>    - Zone · Cache Purge · Purge
> 5. **Account Resources**: Include All accounts
> 6. **Zone Resources**: Include All zones
> 7. Click **"Continue to summary"** → **"Create Token"**
> 8. Copy the displayed token - **a window will open for you to paste it** (I never see it)

Store it in the vault (masked input in a window, outside Claude's context):
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name CLOUDFLARE --service Cloudflare --fields "api_token:secret"
```

Then **validate** the token (read from the vault, never displayed):
```bash
CFTOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get CLOUDFLARE api_token)
curl -s -H "Authorization: Bearer $CFTOK" https://api.cloudflare.com/client/v4/user/tokens/verify | grep -q '"success":true' && echo "VALID" || echo "INVALID"
```
- **VALID** → ✅ Cloudflare ready (token in the vault).
- **INVALID** → propose again (token copied wrong / incomplete permissions): re-run the `add` to overwrite, then re-validate.

**Wrangler**: `scripts/wrangler-env-init.mjs` now reads the token from the vault (`CLOUDFLARE.api_token`) and exports it as an env var for the session before calling wrangler.

⚠️ **Check the Wrangler account after login** (in case the user already has a Wrangler logged in to a DIFFERENT account):

```bash
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/local-desktop-app-uploads/hypervibe"
eval "$(node "$PLUGIN_DIR/scripts/wrangler-env-init.mjs")"
wrangler whoami 2>&1 | head -8
```

If the displayed email does not match the account on which the token was created → direct the user to `wrangler logout` then `wrangler login` to resync.

- If INVALID → ask the user again (maybe they copied it wrong, or the permissions are incomplete - re-check the checklist above).

#### Shared clock + R2 email alert (auto, at the end of /start)

Once **all the other dependencies are configured** (Wrangler authenticated, Brevo configured with at least one verified sender), provision the **unified shared worker `hypervibe-jobs`**: ONE Cloudflare Worker for all the account-wide scheduled jobs (cron pings, database backups, quota alerts), consuming a single Cloudflare cron slot, with a git-versioned registry in `~/.hypervibe-jobs/`:

```bash
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/local-desktop-app-uploads/hypervibe"
eval "$(node "$PLUGIN_DIR/scripts/wrangler-env-init.mjs")"
node "$PLUGIN_DIR/scripts/shared-worker/ensure.mjs"
```

JSON output: `{ ok, status: "created" | "already_present", ... }`. If `ok: false` → report it briefly, do not block (the worker can be provisioned later via `/quotas` or `/add-backup-db`).

Then register the **quota watch job** (daily check via the CF GraphQL API, email via Brevo on overage; initially Cloudflare R2 storage, threshold 9 GB out of the 10 GB free tier, configurable via `--r2-threshold-gb`):

1. `node "$PLUGIN_DIR/scripts/shared-worker/register.mjs" --list` → if the `jobs` array already contains a job named `quota-monitor`, skip (silent).
2. Otherwise discover the recipient and the sender:
   - **Recipient** = the Cloudflare account email: `curl -s -H "Authorization: Bearer $CFTOK" https://api.cloudflare.com/client/v4/user` → take `result.email` (CFTOK read from the vault as above).
   - **Sender** = the first verified Brevo sender: `BREVO_API_KEY=$(node "$PLUGIN_DIR/scripts/vault/vault.mjs" get BREVO api_key); curl -s https://api.brevo.com/v3/senders -H "api-key: $BREVO_API_KEY"` → take the first entry with `"active": true`. If there is none → ask the user to verify a sender on https://app.brevo.com/senders. Do not block if the user declines, just continue (the job can be registered later via `/quotas`).
3. Register (also uploads the CLOUDFLARE_API_TOKEN + BREVO_API_KEY secrets, read from the vault): `node "$PLUGIN_DIR/scripts/shared-worker/register.mjs" --kind quota --recipient <email> --sender-email <sender> --put-secrets`

**Why a custom job rather than Cloudflare's native "Billing Alerts"**: Cloudflare's Billing Alerts are reserved for Pro+ plans, and the CF API is under-documented for free accounts (the first version used `billing_usage_alert` but it triggered false alerts because of an ambiguous threshold format). The shared worker does exactly what we want, on a single Cloudflare cron slot for the whole account.

What to say in the onboarding summary:
- Worker `created` (and/or quota job just registered) → mention once: *"Your shared clock is in place: one mechanism for all your projects' scheduled tasks, database backups and quota alerts. It will email you if you approach the 10 GB of the R2 free tier."*
- `already_present` and quota job already registered → say nothing (silent).
- Missing verified sender → covered in point 2 above.
- Any other error → report it briefly, it is not critical.

### Missing CLIs

If some CLIs (GitHub, Vercel, Wrangler) are missing or not connected, propose:

> I can install and connect the missing CLIs automatically:
> - **GitHub CLI** - to create the Git repos
> - **Vercel CLI** - to deploy your app
> - **Wrangler CLI** - for Cloudflare (Workers + R2). No separate login: it uses the token from the vault.
>
> A script will open in a new window and do everything in order: for each CLI, it installs then connects you before moving on to the next.
>
> **Shall I launch it?**

⚠️ **Wait absolutely for the user's confirmation before continuing.**

Only list the CLIs that are actually missing or not connected. (No more Resend CLI: email goes through the Resend API with the vault key, collected in Step 7bis.)

### Everything is already installed and connected

If everything is OK, jump directly to step 6.

---

## Step 5 - Launching the CLIs script

Once the user has confirmed, run the plugin's dedicated script based on the OS.

Determine the plugin path:
```bash
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/local-desktop-app-uploads/hypervibe"
```

### Windows

```bash
powershell.exe -ExecutionPolicy Bypass -File "${PLUGIN_DIR}/scripts/setup-clis-windows.ps1"
```

The script opens a CMD window that installs + logs in each CLI sequentially (already installed / already connected → skip). Technical details (CMD escaping, sequence) are commented at the top of the `.ps1`.

> A window just opened. It installs and connects each tool one by one. Follow the on-screen instructions (a browser will open for each login). Come back here when you see "Reviens dans Claude pour continuer."

### macOS

```bash
chmod +x "${PLUGIN_DIR}/scripts/setup-clis-mac.sh"
bash "${PLUGIN_DIR}/scripts/setup-clis-mac.sh"
```

The script opens a macOS Terminal and handles each CLI sequentially.

> A terminal just opened. It installs and connects each tool one by one. Follow the on-screen instructions. Come back here when you see "Reviens dans Claude pour continuer."

⚠️ **ABSOLUTE RULE** (Windows & Mac): after launching the script, **DO NOTHING** until the user comes back to explicitly confirm that it is done. The script is autonomous - Claude must not interfere.

---

## Step 6 - Final verification

⚠️ **ABSOLUTE RULE**: No matter what the user says ("it's done", "finished", "I did Ctrl+C", "it crashed", "I closed the window"), **always** run the verification commands below before concluding anything. NEVER assume a tool is OK based on a verbal confirmation - the script may have been interrupted, a login may have failed, etc.

### Mandatory verifications

Run **all** these commands and read the output of **each one** carefully:

```bash
export PATH="$PATH:/c/Program Files/GitHub CLI:/c/Program Files/nodejs:/c/Users/$USERNAME/AppData/Roaming/npm"
node --version 2>/dev/null
pnpm --version 2>/dev/null
git --version 2>/dev/null
gh --version 2>/dev/null
gh auth status 2>/dev/null
vercel --version 2>/dev/null
vercel whoami 2>/dev/null
wrangler --version 2>/dev/null
wrangler whoami 2>/dev/null
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" status 2>/dev/null
CFTOK=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get CLOUDFLARE api_token 2>/dev/null) && curl -s -H "Authorization: Bearer $CFTOK" https://api.cloudflare.com/client/v4/user/tokens/verify | grep -o '"success":[a-z]*'
```

For **Neon**: no more MCP detection. Verify that the key is in the vault: `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get NEON api_key >/dev/null 2>&1 && echo neon-ok || echo neon-missing` (collected in Step 7 if missing).

For **Resend**: `node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get RESEND api_key >/dev/null 2>&1 && echo resend-ok || echo resend-missing` (collected in Step 7bis if missing).

For the **vault**: `vault.mjs status` must say `unlocked`. If `locked`/`expired` → unlock (`launch.mjs unlock`).

For Wrangler: `wrangler whoami` must display the Cloudflare account email. If it says "not authenticated" → the token is not seen: verify that `wrangler-env-init.mjs` does read the vault (it exports `CLOUDFLARE_API_TOKEN` from the `CLOUDFLARE` item before calling wrangler). If `wrangler whoami` succeeds AND `tokens/verify` = `"success":true` → ✅ Cloudflare ready.

### Strict classification of each tool

For each tool, determine the real state from the command output:
- ✅ **installed + connected** (the `whoami` or `auth status` command returns a user/email)
- ⚠️ **installed but not connected** (`--version` OK but `whoami` fails or says "not logged in")
- ❌ **not installed** (`--version` fails with "command not found" or equivalent)

**Never tick ✅ a tool that responded with an error, a timeout, or "not logged in".** A displayed version is not enough: you also need the login for the CLIs that require it (gh, vercel) OR the Cloudflare token (from the vault) for wrangler.

### Report presentation (mandatory)

Display an exhaustive report based **strictly** on what was detected:

> **Environment:**
>
> ✅ Node.js: vX.X.X
> ✅ pnpm: vX.X.X
> ✅ Git: vX.X.X
> ⚠️ GitHub CLI: installed but not connected
> ❌ Vercel CLI: not installed
> ✅ Wrangler CLI + Cloudflare token (vault): ready
> ✅ Vault: operational (unlocked)
> 🔑 Neon: key in the vault
> 🔑 Resend: key in the vault

**"Vault" line, to display based on the real detected state** (same ✅/⚠️/❌ logic as the CLIs, based on `vault.mjs status`):
- ✅ **operational (unlocked)**: `vault.mjs status` = `unlocked`.
- ⚠️ **installed but locked**: `vault.mjs status` = `locked` or `expired` (account connected, vault closed). Action: `launch.mjs unlock`.
- ❌ **not yet installed**: `bw` missing or `bw status` = `unauthenticated` (no account). Action: go back through Step 3bis (`install-bw.mjs` + `_add-keyring`).

The unlocked vault (✅) is a **blocking prerequisite** (see Strict branching below): never display ✅ if `vault.mjs status` has not explicitly responded `unlocked`.

### Strict branching

- **If AND ONLY IF the 6 essentials (Node, pnpm, Git, GitHub CLI connected, Vercel connected, Wrangler+Cloudflare token) are ✅** AND the vault is unlocked → move on to step 8. Note the state of Neon and Resend without blocking.
- **Otherwise (even a single missing or not-connected tool)** → stay here, **NEVER say "everything is installed and connected"**, **NEVER move on to step 8**.

### Case: interrupted script or partial installation

If the verification reveals missing tools (typical case: the user did Ctrl+C, closed the window, the script crashed, or a login was refused), proceed as follows:

1. **List precisely** what was done and what remains, following the script's order (GitHub → Vercel → Wrangler):

   > The script was interrupted before the end. Here is where things stand:
   >
   > ✅ GitHub CLI - installed and connected
   > ⚠️ Vercel CLI - installed but not connected
   > ❌ Wrangler CLI - not yet installed
   >
   > 1 thing remains to do.

2. **Propose a concrete action** - by default, re-run the script (it detects what is already OK and skips it, so it is 100% safe):

   > I can:
   > - **Re-run the script** (it picks up where it stopped, without touching what is already OK) - recommended
   > - OR install/connect the missing tools by hand if you prefer
   >
   > **What do we do?**

3. **Wait for confirmation** before any action. Once the fix is done, **come back to Step 6** (re-check all the commands) - never jump directly to step 8.

---

## Step 7 - Neon API key in the vault

The Neon API key is used for provisioning (`/add-db`) and **automatic backups** (`add-backup-db`). We store it in the vault (item `NEON`, field `api_key`), **once per machine**. Optional here - if the user is not planning to do a DB right away, they can skip it (it will be requested at the first `/add-db`).

### Check whether the key is already in the vault

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get NEON api_key >/dev/null 2>&1 && echo "have-key" || echo "missing-key"
```

If `have-key` → display *"✅ Your Neon key is already in your vault"* and move on to Step 8.

If `missing-key` → open the page (best-effort) and guide:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://console.neon.tech/app/settings/api-keys" 2>/dev/null
```

> **In order to be able to create databases**, I need a Neon key (just once - I store it in your vault).
>
> 1. On the page that just opened, click **Create new API key**, name it `claude-code`.
> 2. **Copy the key** (displayed only once).
> 3. A window will open: paste it in (masked input, I never see it).
>
> *(No need right now if you are not planning to create a DB right away - I will ask you for it again at your first `/add-db`.)*

Store it in the vault:
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name NEON --service Neon --fields "api_key:secret"
```

Confirm:

> ✅ Your Neon key is in your vault. You will never have to retype it. The automatic backups will activate on their own at each `/add-db`.

---

## Step 7bis: Resend (email) key in the vault

The Resend API key is used for sending emails (`/add-email`, contact page, notifications). We store it in the vault (item `RESEND`, field `api_key`), once per machine.

### Check whether the key is already in the vault

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get RESEND api_key >/dev/null 2>&1 && echo "have-key" || echo "missing-key"
```

If `have-key` → display *"✅ Your Resend key is already in your vault"* and move on to Step 8.

If `missing-key` → open the page (best-effort) and guide:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "https://resend.com/api-keys" 2>/dev/null
```

> **In order to be able to send emails from your apps**, I need a Resend key (just once, I store it in your vault).
>
> 1. On the page that just opened, click **Create API Key**, name it `claude-code`, leave **Permission** on **Full access**.
> 2. **Copy the key** (`re_...`, displayed only once).
> 3. A window will open: paste it in (masked input, I never see it).

Store it in the vault:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name RESEND --service Resend --fields "api_key:secret"
```

Validate (read from the vault, never displayed):

```bash
RKEY=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get RESEND api_key)
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $RKEY" https://api.resend.com/domains | grep -q 200 && echo "VALID" || echo "INVALID"
```

> ✅ Your Resend key is in your vault. `/add-email` will use it directly.

---

## Step 8 - Quick overview

> **Everything is good!** You can launch your first project with:
>
> `/bootstrap` - Describe what you want to build, I take care of the rest.
>
> 💡 **Tip**: if you want to understand how everything works before getting started (the technical stack, the various plugin commands, deployment, etc.), run `/prof` - it is an educational mode that explains everything to you in plain language.

---

## Step 9 - Global rules for Claude Code

Before finishing, we make sure that Claude Code (on this machine) has a set of rules in its global CLAUDE.md. These rules apply to all projects - they avoid the classic pitfalls (pointless builds, unintended deployments, `any` in TypeScript, forgetting mobile-first responsive, etc.).

⚠️ **Conditional rules**:
- **Neon** → **always** pass `--with-neon` (adds the rule "Neon = REST API + vault key + run-sql helper").
- If **Gitleaks** was installed (`OK` or `INSTALLED` in Step 3, not `ERROR`) → pass `--with-gitleaks` (adds the rule explaining the global hook and how to bypass a false positive).

Run this script - it creates the file `~/.claude/CLAUDE.md` if it is missing, and maintains a block delimited by `<!-- hypervibe:rules -->` … `<!-- /hypervibe:rules -->` in it. Idempotent: each rule has its own marker `<!-- rule:<id> -->`, so re-running `/start` later will add ONLY the missing rules (without touching those already present, even if you customized them).

```bash
PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/local-desktop-app-uploads/hypervibe"
# Build the list of flags based on the capabilities detected in steps 2 and 3.
FLAGS=(--with-neon)   # Neon = always REST + vault now
# If Gitleaks was installed in Step 3 (status_gitleaks = "ok" or "installed"):
[ "$STATUS_GITLEAKS" = "ok" ] || [ "$STATUS_GITLEAKS" = "installed" ] && FLAGS+=(--with-gitleaks)
node "$PLUGIN_DIR/scripts/update-global-claude-md.mjs" "${FLAGS[@]}"
```

(Always pass `--with-neon`. For gitleaks: if the script displayed `OK`/`INSTALLED` → add `--with-gitleaks`, otherwise not.)

Based on the result displayed by the script:

- **`no-change`** → say nothing to the user, move on to step 10.
- **`created`** → announce:

  > I added a global rules block to your CLAUDE.md (`~/.claude/CLAUDE.md`) that will apply to all your projects: no `pnpm build` to check the code, no `git push` or deployment without your approval, TypeScript never `any`, mobile-first responsive, and several other web conventions.

- **`upgraded`** → announce:

  > I updated the global rules block in your CLAUDE.md (`~/.claude/CLAUDE.md`) - the old format (without per-rule markers) was replaced by the current version.

- **`updated +N`** (where N is a number) → announce:

  > I added N new rule(s) to your global CLAUDE.md (`~/.claude/CLAUDE.md`). The rules you already had were not modified.

---

## Step 10 - Conclusion

> **It's ready! ✨** Over to you.
