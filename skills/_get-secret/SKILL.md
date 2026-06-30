---
name: _get-secret
description: Internal pattern for reading a secret from the user's Bitwarden vault inside any skill. Defines the canonical Bash idiom (read into a shell variable, never print) plus the auto-unlock orchestration (if the vault is locked or the 12h session expired, open the unlock window, then retry). Referenced by every skill that consumes a global key from the vault (Cloudflare, Neon, Hostinger, Resend/Brevo, registrar tokens, Anthropic). Not meant to be invoked directly by users.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _get-secret - read a secret from the vault (internal pattern)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Any skill that needs a **global key** (Cloudflare, Neon, Hostinger, Resend/Brevo, registrar token, Anthropic...) reads the value from the Bitwarden vault via this pattern. **Never** ask the user for the key if it is in the vault, and never display it.

## Golden rule

A secret's value **must never enter the Claude context**: no `echo`, no print, no "tool output". You read it into a **shell variable** and use it **within the same Bash call** (curl, etc.).

## Never pre-check the vault state

**Do NOT call `bw status` (or anything else) to "check whether the vault is open" before reading.** `bw status` always shows `locked` even when the vault is open (the `bw` daemon has no session of its own): you would wrongly conclude that you need to unlock. The **only** correct way to know whether a read is possible is to **perform the read**: run `node "$VAULT" get <ITEM> <FIELD>` directly and **act on its exit code** (table below). The get itself validates the session (a real vault read with the token) and cleanly distinguishes "session to re-unlock" (3) from "key missing" (4).

## The workhorse

From any skill, `CLAUDE_SKILL_DIR` points to that skill's folder; the vault scripts are therefore at `../../scripts/vault/`:

```
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
LAUNCH="${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs"
```

`node "$VAULT" get <ITEM> <FIELD>` writes the value to stdout (without a newline) and returns an **exit code**:

| Code | Meaning | Action |
|---|---|---|
| 0 | OK | use the value |
| 2 | vault locked (no session) | unlock then retry |
| 3 | session expired (>12h) | unlock then retry |
| 4 | item missing | offer the user to add it (see below) |
| 5 | field missing | item exists but not this field - check the field name |

## Canonical Bash pattern (to copy into skills)

```bash
VAULT="${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs"
VAL=$(node "$VAULT" get CLOUDFLARE api_token); RC=$?
if [ $RC -eq 0 ]; then
  # Use $VAL directly, here, without ever displaying it:
  curl -s -H "Authorization: Bearer $VAL" https://api.cloudflare.com/client/v4/...
fi
echo "rc=$RC"   # log ONLY the code, never $VAL
```

## Auto-unlock (if RC = 2 or 3)

When `RC` is 2 or 3, warn the user **in the chat** then open the unlock window (blocking), and **retry**:

> "Your vault is locked - a window will open for your master password."

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" unlock   # blocks until the window is closed
# then redo the get
VAL=$(node "$VAULT" get CLOUDFLARE api_token); RC=$?
```

The master password is typed **in the window**, never in the chat. The session stays valid for 12h (a single unlock per day).

## Key missing (RC = 4)

The item is not in the vault yet. Offer to add it (the value will be entered in a masked window, never via Claude):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add --name CLOUDFLARE --service Cloudflare --fields "api_token:secret"
```

For a multi-field key (e.g. Qonto): `--fields "api_key:secret,slug:text"`.

## Item naming conventions (folder `Global`)

| Item | Field(s) | Service |
|---|---|---|
| `CLOUDFLARE` | `api_token` | Cloudflare |
| `NEON` | `api_key` | Neon |
| `HOSTINGER` | `api_token` | Hostinger |
| `ANTHROPIC` | `api_key` | Anthropic (agents) |
| `RESEND` / `BREVO` | `api_key` | Email |

If the vault is not configured at all (no `bw`, no account), it is `_add-keyring` that sets everything up - point the user to that skill.
