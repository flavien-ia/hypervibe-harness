---
name: _track-resource
description: Internal helper - records a cloud resource in the project's resource manifest (`.hypervibe/resources.json`), right after a skill creates or adopts it. The manifest is what /save-project and /delete-project read first, instead of guessing resources by name similarity. Triggered by every provisioning skill (add-db, add-storage, add-domain, add-cron, add-backup-db, add-stripe, bootstrap, _create-cloudflare-worker, _create-render-worker...). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash Read
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Track resource - Internal helper

You record a cloud resource in the project's **resource manifest**: `.hypervibe/resources.json`, at the project root, versioned with the code. You work silently - no user-facing message for a successful recording.

## Why this matters

Backups and deletion used to rediscover resources by matching their names against the project name. That inference fails silently both ways: a bucket named differently from the project is missed (a backup ships without a single file), and a similarly-named resource of another project can be swept in. At the moment a resource is **created**, its identity is known with certainty - the manifest keeps that certainty. A resource that is not recorded is invisible to `/save-project` and `/delete-project` until their name-guessing fallback happens to find it.

## The command

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/manifest/manifest.mjs" add \
  --project-dir "<project-root>" \
  --kind <kind> --name "<name>" \
  [--id "<stable-id>"] [--field k=v ...] \
  --added-by <calling-skill> [--shared] [--note "<short human note>"]
```

- **Idempotent**: re-running updates the entry in place (`action: "unchanged"` or `"updated"`). Call it unconditionally after the resource exists - including when the resource already existed and the skill merely connected it to the project.
- **`--id` whenever a stable id exists** (Vercel `projectId`, Neon project id, Stripe webhook id...). Ids survive renames; names do not.
- **`--shared` for mutualized infrastructure** (e.g. the `hypervibe-jobs` worker, used by every project on the machine). A shared resource is listed so backups know it exists, and deletion knows to NEVER remove it.
- The script prints one JSON line. `ok: false` means the write was refused - read `reason` and fix the call; do not silence it.

## Kinds and their fields

| Kind | `--name` | `--id` | Typical `--field` |
|---|---|---|---|
| `vercel-project` | project name | `prj_...` | `orgId=team_...` |
| `neon-project` | Neon project name | Neon project id | `host=ep-....neon.tech` |
| `r2-bucket` | bucket name | - | `jurisdiction=eu` (or `default`) - ALWAYS set it |
| `cf-worker` | worker name | - | - |
| `dns-zone` | apex domain (`example.com`) | Cloudflare zone id | - |
| `render-service` | service name | `srv-...` | - |
| `stripe-webhook` | endpoint URL | `we_...` | - |
| `upstash-db` | database name or REST host | - | - |
| `cron-job` | job name | - | `worker=hypervibe-jobs`, `schedule=0 3 * * *` |
| `db-backup` | backup target name | - | `worker=hypervibe-jobs` |
| `email-route` | address (`contact@example.com`) | - | `zone=example.com` |
| `github-repo` | `owner/repo` | - | - |

## Hard rules

1. **Identifiers only, never secrets.** No tokens, keys, passwords, connection strings. The script refuses field names and values that look like credentials - if it refuses, the fix is to drop that field, never to rename it around the guard.
2. **`.hypervibe/` is committed.** Never add it to `.gitignore`; the manifest documents the project's infrastructure for humans too. (Secrets never being in it is what makes this safe.)
3. **Record after the resource exists**, not before: a failed provisioning must not leave a phantom entry. If a skill deletes or replaces a resource (e.g. `add-storage` switching buckets), also run `remove` for the old one:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/manifest/manifest.mjs" remove \
  --project-dir "<project-root>" --kind r2-bucket --name "<old-bucket>" --jurisdiction eu
```

4. **The manifest is declarative, not authoritative.** Consumers (`/save-project`, `/delete-project`) still scan the real accounts and surface differences; recording here does not replace their checks, it feeds them.
