---
name: _hash-password
description: Internal helper to hash a password with Node's native scrypt (NOT bcrypt - bcrypt hashes contain $ characters that break shell and env var handling). Delegates to the bundled scripts/hash-password.mjs. Can hash a provided password or generate + hash a random one. Output format is `salt:hash` (hex:hex), shell-safe. Used by add-auth for admin credentials. Never writes secrets to files. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Hash Password - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Hash a password with scrypt. Delegates to a bundled Node script - never reimplement inline.

## Why scrypt, not bcrypt

bcrypt hashes contain `$` (e.g. `$2b$10$...`). `$` is interpreted by shells and mangled by `vercel env add`, causing silent corruption. scrypt hashes are plain `salt:hash` hex strings, fully shell-safe and env-var-safe.

**If you see bcrypt hashes anywhere in the project** (`$2a$`, `$2b$`, `$2y$` prefixes), refuse and tell the user to rehash in scrypt first.

## Invocation

### Hash a provided password (password supplied via stdin - never via argv)

```bash
HASH=$(printf '%s' "Admin1234!" | node "${CLAUDE_SKILL_DIR}/../../scripts/hash-password.mjs")
```

Returns a single line on stdout: `salt:hash` (both hex), no trailing newline. Capture it directly in a shell variable.

### Generate a random password AND hash it

```bash
OUT=$(node "${CLAUDE_SKILL_DIR}/../../scripts/hash-password.mjs" --generate --length 24 --format alphanumeric)
```

Returns two lines on stdout:

```
password=<plain password>
hash=<salt:hash>
```

Parse them with `grep '^password=' <<< "$OUT"` / `sed 's/^password=//'` (or with `OUT | awk -F= ...`).

The caller must:
1. Pass the `hash` to `_push-env-vars` to store it in `.env` and Vercel.
2. Display the **plain password ONCE** to the user in the final summary, with a note that it's not stored anywhere else.

## Defaults

- `--length 24` for `--generate` (24 chars = ~143 bits of entropy, still typeable)
- `--format alphanumeric` for `--generate` (no special chars, comfortable in a terminal)

## Rules

- **Always** use this helper (never inline `scryptSync` or `bcrypt`).
- Never write the plain password or the hash to a file. Keep them in shell variables, pipe them to the next step.
- Never log hashes or passwords to stdout outside of the dedicated display-once moment.
- The scrypt parameters are `salt=16 bytes`, `keylen=64 bytes`. Verification in the project uses the same params (in `src/lib/password.ts` created by `add-auth`), with `timingSafeEqual` to prevent timing attacks.
