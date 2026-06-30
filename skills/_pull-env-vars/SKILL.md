---
name: _pull-env-vars
description: Internal helper to pull environment variables from Vercel for a given target (production, preview, development) and return them as JSON or merge them into the local .env.local. Delegates to the bundled scripts/pull-env-vars.mjs. Used by skills that need to read current Vercel state - rotate-secret (verify before rotation), debug flows ("why is this var weird in prod"), disaster recovery (restore .env.local from Vercel). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Pull Env Vars - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Pull env vars FROM Vercel for inspection or restoration. Delegates to a bundled Node script - never reimplement the pull logic inline.

## Invocation

From the **project root** (where `.vercel/project.json` lives), call:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pull-env-vars.mjs" --target=<env> [--keys=KEY1,KEY2] [--write-to-local] [--json]
```

### Flags

- `--target=production|preview|development` - **required**. Which Vercel environment to read from.
- `--keys=KEY1,KEY2,...` - optional. Filter the output to only these keys. If omitted, returns all env vars from that environment.
- `--write-to-local` - optional. Merge the pulled values into `.env.local` (preserves existing keys not in the pull, adds new ones, updates values for keys present in both).
- `--json` - optional. Output machine-readable JSON `{KEY: value, ...}`. Default is human-readable text suitable for relay to the user (without showing the values for sensitive keys, only key names + presence).

### Output modes

**Default (text, safe to relay):**
```
3 variables pulled from production:
  - STRIPE_SECRET_KEY (✅ present)
  - DATABASE_URL (✅ present)
  - BREVO_API_KEY (✅ present)
```

**With `--json` (full values, NOT to relay verbatim to chat):**
```json
{"STRIPE_SECRET_KEY":"sk_live_xxx","DATABASE_URL":"postgresql://..."}
```

⚠️ **If you use `--json`, capture the output into a shell variable, process it, and NEVER relay it in plain text to the user.** The JSON output is meant for programmatic use on the script side (for example: comparing a value before/after rotation, restoring a lost `.env.local`).

## Rules

- **Always** use this helper (never `vercel env pull` inline) so the merge logic and quoting are uniform.
- Requires `vercel` CLI installed and authenticated. The script aborts cleanly if Vercel is not linked to the project (no `.vercel/project.json`).
- The `--write-to-local` merge **never deletes** keys that are present in `.env.local` but absent from the pull. Handle removals by hand if needed.
- If the script fails, relay the error message - do not try to reimplement it.

## Security

The pulled values are written only:
- To a temporary file (`os.tmpdir()`, deleted at the end) during processing
- To `.env.local` if `--write-to-local` (this file is `.gitignore`d by default)
- To stdout as JSON if `--json` (to be handled with care)

Never displayed in plain text on stderr or in the logs.
