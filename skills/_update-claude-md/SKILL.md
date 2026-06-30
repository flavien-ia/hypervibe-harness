---
name: _update-claude-md
description: Internal helper to add or update entries in the project CLAUDE.md file idempotently. Accepts a target section (Stack, Key Commands, Conventions, Environment Variables, or a custom heading) and one or more lines to add. Detects and skips duplicates so re-running a skill doesn't add the same line twice. Creates missing sections when needed. Triggered by every add-* skill. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Update CLAUDE.md - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You add or update entries in the project `CLAUDE.md` file idempotently. You work silently.

---

## Target sections

The CLAUDE.md file follows a conventional structure created by `/bootstrap`. Recognized sections:

| Section | Purpose | Example line |
|---|---|---|
| `stack` | Technologies used | `- **Database**: Neon PostgreSQL` |
| `commands` | CLI commands | `- \`pnpm db:push\` - Push schema to Neon` |
| `conventions` | Coding rules / patterns | `- DB: import from \`@<project-name>/db\`, never a cross-app relative path.` |
| `env-vars` | Environment variables list | `- \`DATABASE_URL\` - Neon connection string` |
| `custom` | A free-form section with its own heading | `## Change the admin password in production` |

---

## Inputs expected from the caller

The caller passes something like:

> Add to CLAUDE.md:
> - section: `stack`, line: `- **Database**: Neon PostgreSQL`
> - section: `commands`, lines: [`\`pnpm db:push\` - Push schema`, `\`pnpm db:studio\` - Open Drizzle Studio`]
> - section: `conventions`, line: `- DB: import from \`@project/db\`, never a cross-app relative path.`

Or for a custom section:

> Add to CLAUDE.md a custom section:
> - heading: `## Configure the Stripe webhook in production`
> - body: (multi-line text)

---

## Step 1 - Read CLAUDE.md

```bash
test -f CLAUDE.md && echo "exists" || echo "missing"
```

### If missing

Create a minimal CLAUDE.md template:

```markdown
# <project-name>

<one-line description>

## Stack

## Key Commands

## Conventions

## Environment Variables
```

Read the project name from `package.json`:
```bash
node -e "process.stdout.write(require('./package.json').name)"
```

Write the initial file, then continue to Step 2.

### If present

Read the full file content and identify existing sections.

## Step 2 - Locate the target section

For each standard section, use these heading patterns (case-insensitive):

| Section | Recognized headings |
|---|---|
| `stack` | `## Stack`, `## Tech Stack`, `## Technologies` |
| `commands` | `## Key Commands`, `## Commands`, `## Scripts` |
| `conventions` | `## Conventions`, `## Rules`, `## Guidelines` |
| `env-vars` | `## Environment Variables`, `## Env Vars`, `## Environment` |

If the target section exists → use it as the anchor for insertion.

If the target section does not exist → create it. Insert the new section **after the last existing standard section** (so Stack comes before Commands, etc., following the order `stack` → `commands` → `conventions` → `env-vars` → custom sections). If no standard section exists, append at the end.

## Step 3 - Check for duplicates (idempotency)

For each line the caller wants to add:

1. Normalize both the existing lines and the new line (trim whitespace, lowercase comparison).
2. If an **exact** match already exists in the target section → **skip** this line silently.
3. If a **partial** match exists (e.g., same key `- **Database**: ...` but different value), **replace** the existing line instead of adding a new one. This handles the case where the user swapped their DB from Postgres to SQLite.

For custom sections, check if a section with the exact same `## heading` already exists:
- If yes → **replace** the existing section's body with the new body.
- If no → append a new section at the end of the file.

## Step 4 - Apply the edit

Use the `Edit` tool with enough surrounding context to disambiguate (not just the line to change - include 1-2 lines before and after for uniqueness).

For new sections, use `Write` to append the section at the right location.

**Always preserve** the file's existing structure: don't reorder existing sections, don't reformat existing lines, don't remove unrelated content.

## Step 5 - Verify

Read the file back and confirm:
- The new line(s) are present
- No duplicate exists
- The file structure is intact (all pre-existing sections still present)

## Step 6 - Report

Report back to the caller:

> ✅ CLAUDE.md updated:
> - stack: +1 line (Database: Neon PostgreSQL)
> - commands: +2 lines
> - conventions: +1 line, 0 replaced

Or, if nothing changed (all lines already present):
> ℹ️ CLAUDE.md already up to date - no changes needed.

---

## Edge cases (handled by the Steps above, listed here as a reminder)

- **Multiple lines for the same key**: if `- **Database**: ...` appears **twice** in Stack (bug from an older plugin), deduplicate it silently as part of the work.
- **Custom section with the same heading**: replace the body, do not create a second identical `## heading`.
