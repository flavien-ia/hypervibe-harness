---
name: _open-and-paste
description: Internal pattern helper for skills that need the user to open a URL in their browser, perform a manual action (regenerate a key, create an OAuth client, copy a webhook secret, etc.), and paste the resulting value back. Standardizes the UX across all skills that require this flow - consistent messaging, browser auto-open, optional format validation, retry on invalid input. Triggered by any add-* skill or rotate-secret when a value must be obtained from an external provider's dashboard. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _open-and-paste - Browser interaction + paste pattern

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Internal helper to standardize the flow *"the user goes into their browser, performs a manual action at a provider, and pastes the value here"*. To be invoked from any skill that needs to ask the user to fetch a value from a third-party provider.

There is no "binary" to call - this is a **standardized communication pattern** that the calling skill follows, plus a small utility script to open the browser.

---

## When to use it

Any skill that needs to obtain a value from the web interface of an external provider (CF tokens, Stripe/Brevo/Resend/Anthropic/OpenAI API keys, Google/GitHub OAuth credentials, etc.) where the provider's public API does not allow programmatic creation/reading.

## When NOT to use it

- If the value can be generated locally (use `_generate-secret`)
- If the value is already in `.env` (no need to re-paste)
- If the provider's API allows programmatic creation (do a direct curl)

---

## Full pattern - 5 steps

### Step 1 - Announce the action to the user

Display a structured message, **always prefixed with 🌐** to visually signal that a manual action is required.

Template:

> ## 🌐 An action from you
>
> I'm going to open **<PROVIDER_NAME>** in your browser (URL: `<URL>`). Here's what you'll do:
>
> 1. <instruction 1 in plain language>
> 2. <instruction 2>
> 3. <instruction 3>
> 4. Copy the value (which looks like `<example format>`) and come back here to paste it.
>
> <⚠️ warning if the value is one-shot - see the dedicated section below>

### Step 2 - Open the browser

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/open-url.mjs" "<URL>"
```

The script handles cross-platform (macOS `open`, Windows `start`, Linux `xdg-open`). If the open fails silently (very rare), no big deal - the URL is shown in plain text in the Step 1 message anyway, so the user can copy and paste it.

### Step 3 - Wait for the user's value

The user pastes it in their next message. **Capture it in a mental variable**, and **never relay it in plain text** in your subsequent replies.

### Step 4 - Optional format validation

If the calling skill provided an expected pattern (regex), check the value in the script or inline:

- **Match** → continue (Step 5)
- **No match** → clear message:
  > The value you gave me doesn't look like what I expected (expected: `<format description>`, for example `sk_live_...`). Could you double-check it and give it to me again? If you're sure it's correct, tell me *"force"* and I'll continue anyway.

Max **3 attempts** on invalid format, then a clean abort.

### Step 5 - Confirm (without revealing the value)

> ✅ Value received (length: 47 characters, prefix `sk_live_`). I'm continuing with <next action>.

The caller moves on to the next step (push to Vercel, write to `.env`, etc.).

---

## ⚠️ Warning "one-shot value"

Many providers only display a secret value **once**, at creation time:
- GitHub OAuth client_secret
- Resend API key
- Brevo API key
- Stripe webhook signing secret (signing secret only - Reveal then re-Reveal is possible, but regenerating breaks the webhooks)

For these cases, **add this warning to Step 1**:

> ⚠️ **Important**: this value will **never be displayed again** by <provider> after you close the window. Copy it right away before coming back here.

---

## Catalog of common providers

(to be enriched over time; for V1, here are the most common ones)

### Stripe - Secret Key

- URL: `https://dashboard.stripe.com/apikeys`
- Pre-conditions: Stripe account + the app/sub-account already created
- Instructions:
  1. If you've never revealed the **Secret key**: click **Reveal** on the corresponding row
  2. If you want to generate a new one (rotation): click **Roll key** + confirm
  3. Copy the value (starts with `sk_live_` in production or `sk_test_` in test mode)
- Expected format: starts with `sk_live_` or `sk_test_`, length ~100 chars

### Stripe - Webhook Secret

- URL: `https://dashboard.stripe.com/webhooks`
- Instructions:
  1. Open your app's webhook endpoint
  2. **Signing secret** section → click **Reveal**
  3. Copy the value
- Format: starts with `whsec_`

### Resend - API Key

- URL: `https://resend.com/api-keys`
- Instructions:
  1. Click **Create API Key** at the top right
  2. Give it a descriptive name (e.g., `<project>-prod`)
  3. Copy the value **immediately** (one-shot)
- Format: starts with `re_`
- ⚠️ One-shot

### Brevo - API Key

- URL: `https://app.brevo.com/security/api-keys`
- Instructions:
  1. Click **Generate a new API key**
  2. Give it a name
  3. Copy the value **immediately** (one-shot)
- Format: starts with `xkeysib-`
- ⚠️ One-shot

### Google OAuth - Client ID + Secret

- URL: `https://console.cloud.google.com/apis/credentials`
- Pre-conditions: existing Google Cloud project
- Instructions:
  1. **Create Credentials → OAuth client ID**
  2. Type: **Web application**
  3. Authorized redirect URI: `<app-url>/api/auth/callback/google`
  4. Copy the **Client ID** (format `<digits>-<hash>.apps.googleusercontent.com`)
  5. Copy the **Client Secret** (format starts with `GOCSPX-`)
- 2 values to ask for: `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET`

### GitHub OAuth - Client ID + Secret

- URL: `https://github.com/settings/developers`
- Instructions:
  1. **OAuth Apps → New OAuth App**
  2. Authorization callback URL: `<app-url>/api/auth/callback/github`
  3. Copy the **Client ID** (displayed directly, format `Ov...` or `Iv...`)
  4. Click **Generate a new client secret**
  5. Copy the **Client secret** **immediately** (one-shot)
- ⚠️ The client secret is one-shot

### Anthropic - API Key (workspace-scoped)

- URL: `https://console.anthropic.com/settings/keys?workspace=<workspace-id>`
- Pre-conditions: workspace created beforehand via the Admin API
- Instructions:
  1. **Create Key**
  2. Give it a name (e.g., `<project>-prod`)
  3. Copy the value **immediately** (one-shot)
- Format: starts with `sk-ant-api`
- ⚠️ One-shot

### Anthropic - Admin Key

- URL: `https://console.anthropic.com/settings/admin-keys`
- Instructions: **Create Admin Key**, copy immediately
- Format: starts with `sk-ant-admin`
- ⚠️ One-shot

### Cloudflare - API Token (scoped, custom)

- URL: `https://dash.cloudflare.com/profile/api-tokens`
- Instructions:
  1. **Create Token → Custom token**
  2. Permissions to add (depending on usage): Workers Scripts:Edit, R2:Edit, Workers KV Storage:Edit, etc.
  3. Account Resources: your account
  4. **Continue to summary → Create Token**
  5. Copy the value (40-char hex format)
- Format: 40 alphanumeric characters

### Vercel - Personal Access Token

- URL: `https://vercel.com/account/tokens`
- Instructions:
  1. **Create Token**, give it a name
  2. Scope: Full Account (or Team if applicable)
  3. Expiration: your choice (6 months typical)
  4. **Create**
  5. Copy the value
- Format: varies

---

## Global rules

- **Always display the URL in plain text** in the message - the user may have a browser that doesn't open automatically
- **Always prefix with 🌐** to signal that a manual action is required
- **Always warn if the value is one-shot** (see the list above)
- **Retry max 3 times** on invalid format
- **Never relay the value in plain text** in a Claude reply (unless the user explicitly asks for it for debugging)
- **If multiple values need to be pasted in a row** (e.g., OAuth ID + Secret), ask for them one at a time, not in a batch - clearer for the user and less risk of a paste error
