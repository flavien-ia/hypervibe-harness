---
name: _generate-secret
description: Internal helper to generate a cryptographically secure random secret (API key, JWT secret, webhook secret, CRON_SECRET, etc.). Delegates to the bundled scripts/generate-secret.mjs. Shell-safe by default. Invoked by skills that need a fresh secret (add-auth AUTH_SECRET, add-cron CRON_SECRET, webhook secrets). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Generate Secret - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Generate a cryptographically secure random secret. Delegates to a bundled Node script - never reimplement inline.

## Invocation

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/generate-secret.mjs" [--format FORMAT] [--length N]
```

Output: the secret on stdout, no trailing newline. Capture it with `SECRET=$(node ...)` or pipe it into the next step.

## Formats

| Format | Char set | Size rule | Typical use |
|---|---|---|---|
| `hex` (default) | `[0-9a-f]` | length = **byte** count → `2*N` chars | Webhook secrets, CRON_SECRET. Default length 32 = 256-bit entropy. |
| `base64url` | `[A-Za-z0-9_-]` | length = **byte** count → ~1.33*N chars | NextAuth `AUTH_SECRET`, URL-safe tokens. |
| `alphanumeric` | `[A-Za-z0-9]` | length = **char** count (exactly N) | Human-typeable admin passwords. Use length 24. |

⚠️ **Never use raw `base64`** (contains `/`, `+`, `=` which break URLs and env vars). Always prefer `base64url`.

## Typical usage

- `CRON_SECRET` → `node ...generate-secret.mjs` (hex, 32 bytes = 64 hex chars)
- `AUTH_SECRET` (NextAuth) → `node ...generate-secret.mjs --format base64url`
- Random admin password → prefer `_hash-password --generate` which does both generation + hashing in one go

## Rules

- **Always** use this helper (never inline `require('crypto').randomBytes(...)`).
- Never log the secret or write it to a file. Pipe it straight to `_push-env-vars` or the next operation.
