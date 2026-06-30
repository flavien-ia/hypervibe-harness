---
name: _ensure-vault
description: Internal preflight - make sure the Bitwarden vault is unlocked before a skill reads any global key. Run at the start of every skill that will consume a vault secret (Cloudflare, Neon, Resend/Brevo, Hostinger, Anthropic…), so the unlock window pops once up-front instead of a key-read silently failing mid-flow. Not meant to be invoked directly by users.
user-invocable: false
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _ensure-vault - "the vault is open" preflight

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

To run **at the start** of any skill that will read a key from the vault. Goal: open the unlock window **once up-front** rather than letting a key-read silently fail later (notably the case of scripts that go through `readUserEnv`, which returns `null` without flagging "locked").

Since the vault stays open for 12h, this preflight only triggers a window **once per day**, on first need.

## Snippet (run as-is)

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
ST=$(node "$VAULT" status 2>/dev/null)
echo "vault:$ST"
```

Depending on `ST`:

- **`unlocked`** → vault ready, continue the skill normally.
- **`locked` or `expired`** → notify the user in the chat, then open the unlock window (blocking), then re-check:
  > "Your key vault is closed - a window will open for your master password (once per day)."
  ```bash
  node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock
  node "$VAULT" status   # should return "unlocked"
  ```
- **Empty output / error** (no `bw`, no account connected → vault never configured) → the vault does not exist yet: **delegate to `_add-keyring`** (installs bw + creates the account + login + unlock), then re-check. If the user declines to set up the vault, flag it and stop cleanly (the skill will not be able to retrieve its keys).

## When to use it

Any skill that, directly or via a script (`check-deps`, `setup-db`, `setup-email`, `wrangler-env-init`, `quotas-fetch`, `count-cf-cron-slots`, `gsc-token`, `run-sql`…), will need a global key (Cloudflare, Neon, Resend/Brevo, Hostinger, Anthropic). Do it **before** the bulk of the work.

(Note: the read helpers stay non-interactive - they never open a window themselves. It is this preflight, orchestrated by Claude, that guarantees the vault is open at the right moment.)
