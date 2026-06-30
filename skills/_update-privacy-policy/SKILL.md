---
name: _update-privacy-policy
description: Internal helper to add or remove subprocessors in the project's RGPD privacy policy registry idempotently. Delegates to the bundled scripts/update-privacy-policy.mjs. Triggered by every add-* skill that introduces a third-party data processor (add-db, add-auth, add-google-auth, add-github-auth, add-stripe, add-email, add-storage, add-analytics, add-agent, add-automation). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Update Privacy Policy - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Add or remove subprocessors in the project's RGPD privacy policy registry. Delegates to a bundled Node script - never reimplement the registry edit logic inline.

## Architecture

The helper edits `<web-root>/src/lib/subprocessors.json` (a flat array of subprocessor entries). A thin TS wrapper at `<web-root>/src/lib/subprocessors.ts` re-exports the JSON with a typed signature. The privacy policy page (`src/app/.../politique-de-confidentialite/page.tsx`) is generated once by `/bootstrap` as a pure renderer over the registry - it is never modified by the helper. Only the data file changes when subprocessors are added or removed.

This keeps the page text stable (the user can customize wording) while automating the legally-relevant subprocessor list.

`<web-root>` is auto-detected: `apps/web/` for monorepos, project root otherwise.

## Invocation

From the **project root**, call:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add <key>
```

Multiple keys can be added in one call:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add neon --add resend
```

## Known keys (catalog)

| Key | Trigger skill | Notes |
|---|---|---|
| `vercel` | `/bootstrap` | Always present - added by bootstrap, never by add-* |
| `neon` | `/add-db` | |
| `stripe` | `/add-stripe` | |
| `google-oauth` | `/add-google-auth` | |
| `github-oauth` | `/add-github-auth` | |
| `resend` | `/add-email` (Resend variant) | |
| `brevo` | `/add-email` (Brevo variant) | EU-resident, lighter compliance |
| `cloudflare-r2` | `/add-storage` | |
| `vercel-analytics` | `/add-analytics` (no-cookie variant) | |
| `google-analytics` | `/add-analytics` (cookie variant) | Marks `requiresConsent: true` |
| `anthropic` | `/add-agent` | |
| `render` | `/add-automation` (Render variant) | Only when long-running workers handle user data |

To list the full catalog with all the legal data:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --catalog
```

## Rules

- **Always** delegate to this helper - never edit `subprocessors.json` inline. The catalog data (legal name, address, transfer mechanism, etc.) is curated and shouldn't be reinvented.
- The helper is **idempotent**: re-adding an existing key replaces the entry (so catalog updates propagate). Adding then removing is safe.
- If the `subprocessors.json` file doesn't exist yet, the helper creates it (along with the TS wrapper). This means `/add-*` skills can call it even on projects that pre-date this system - but those projects won't have the rendering page until `/rgpd-audit` is run.
- If the script exits non-zero, relay the failure message to the caller - don't retry inline.
- Calling with an **unknown key** is a hard error (exit 2) - pass an existing catalog key, or extend the catalog in the script first.

## Other operations

```bash
# List currently registered subprocessors (read-only)
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --list

# Remove a subprocessor (e.g., when a service is retired from the project)
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --remove brevo
```

Removals are typically triggered by `/clean` or by manual cleanup, not by add-* skills.
