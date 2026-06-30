---
name: _setup-render
description: Internal helper that ensures the Render API key lives in the Bitwarden vault (item RENDER, field api_key). Triggered by /add-automation and /add-agent before any Render REST API call. No CLI install - Render is driven 100% via its REST API (api.render.com/v1). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup Render (API key in the vault) - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Render is driven **100% via its REST API** (`https://api.render.com/v1`) - **no CLI to install**. This helper just makes sure the Render API key is in the vault, so that any skill can call the API.

The API covers everything the plugin needs: `GET /v1/owners` (workspaces), `GET /v1/services` (services), `GET /v1/logs` (logs). Service creation goes through the `render.yaml` Blueprint + the dashboard anyway (not the CLI).

---

## Step 1 - Make sure the vault is unlocked

Invoke skill: `_ensure-vault` (unlocks the Bitwarden vault, or sets it up via `_add-keyring` if it does not exist).

## Step 2 - Is the Render key already in the vault?

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get RENDER api_key >/dev/null 2>&1 && echo "key:present" || echo "key:missing"
```

- `key:present` → nothing to do, return to the calling skill.
- `key:missing` → continue to Step 3.

## Step 3 - Ask the user to create a Render API key

Tell the user:
> To drive Render (workers, logs) I go through its REST API. I need an API key that you generate yourself:
> 1. Go to https://dashboard.render.com/u/settings → **API Keys** tab
> 2. **Create API Key**, give it a name (e.g. `claude-code`)
> 3. Copy it (you will not be able to see it again afterward)
>
> If you do not have a Render account, create one (free) at https://render.com.
> ⚠️ This key grants full access to your Render account - it goes into your vault, never in plain text in an environment variable.

Then store it in the vault (masked-input window, the value never passes through Claude):
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name RENDER --service Render --fields api_key:secret
```

## Step 4 - Verify

```bash
K=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get RENDER api_key)
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $K" "https://api.render.com/v1/owners?limit=1"
```

Expected: `200`. If `401`, the key is wrong → ask the user again. Otherwise, say:
> ✅ Render key saved in the vault. Render is driven via its REST API - nothing to install.

Return control to the calling skill (`/add-automation` or `/add-agent`).
