---
name: _setup-stripe-cli
description: Internal helper to install and authenticate the Stripe CLI on the user's machine. Triggered automatically by /add-stripe (and any other skill that needs Stripe CLI access) when `stripe --version` fails or when the user is not logged in. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup Stripe CLI - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You install and authenticate the Stripe CLI on the user's machine.

This is a one-time setup. Once done, the Stripe CLI is available globally for all future Bootstrap projects on this machine.

---

## Step 1 - Detect platform

Run `uname -s` to detect the platform:
- `MINGW*`, `MSYS*`, `CYGWIN*` → **Windows**
- `Darwin` → **macOS**
- `Linux` → **Linux**

## Step 2 - Install the CLI

### Windows

Check if Scoop is available:
```bash
scoop --version
```

**If Scoop is installed:**
```bash
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe
```

**If Scoop is not installed**, tell the user:
> To install the Stripe CLI on Windows, I will first install Scoop (a lightweight package manager). If you prefer to install Stripe manually, download the binary from https://github.com/stripe/stripe-cli/releases/latest and add it to your PATH, then let me know when it is done.

If the user accepts Scoop installation, run in PowerShell (the user must launch it manually):
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex
```

Then re-run the scoop install commands above.

### macOS

```bash
brew install stripe/stripe-cli/stripe
```

If Homebrew is not installed, tell the user to install it from https://brew.sh first.

### Linux

```bash
# Add Stripe CLI's GPG key and repository
curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg
echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee -a /etc/apt/sources.list.d/stripe.list
sudo apt update
sudo apt install stripe
```

## Step 3 - Verify installation

```bash
stripe --version
```

Expected output: `stripe version X.Y.Z`. If not, the install failed - investigate before continuing.

## Step 4 - Authenticate

Tell the user:
> I will now connect you to your Stripe account. A window will open in your browser - log in (or create an account if you do not have one yet) and then approve the authorization. If you do not have a Stripe account yet, go to https://dashboard.stripe.com/register.

Run:
```bash
stripe login
```

This opens a browser for OAuth. Wait for the user to confirm.

## Step 5 - Verify authentication

```bash
stripe config --list
```

Should show `test_mode_api_key` or `live_mode_api_key`. If not, the auth failed - re-run `stripe login`.

## Step 6 - Done

Tell the user:
> ✅ Stripe CLI installed and connected. You will not have to do this step again for your future Bootstrap projects.

Return control to the calling skill (typically `/add-stripe`).
