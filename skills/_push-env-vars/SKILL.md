---
name: _push-env-vars
description: Internal helper to push environment variables safely to the local .env AND to Vercel (production + preview + development). Delegates to the bundled scripts/push-env-vars.mjs. Triggered by any skill that needs to set env vars (add-db, add-auth, add-stripe, add-email, add-google-auth, add-github-auth, add-storage, add-analytics, add-cron…). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Push Env Vars - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Push env vars to the local `.env` AND to Vercel (production + preview + development). Delegates to a bundled Node script - never reimplement the push logic inline.

## Invocation

From the **project root** (where `.vercel/project.json` lives), call:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/push-env-vars.mjs" "KEY1=value1" "KEY2=value2"
```

Pass each `KEY=VALUE` as a single shell-quoted argument. The script splits on the first `=` only, so values containing `=` are preserved.

## Rules

- **Always** use this helper (never `vercel env add` / `echo KEY=... >> .env` / `printf ... | vercel env ...` inline).
- The script handles `.env` dedup, `.gitignore` update, the 3 Vercel environments, special characters, and the CLI's preview git-branch quirk (REST API first, CLI fallback).
- If the script exits non-zero, relay the failure message to the caller - don't retry the push logic yourself.
