# /add-backup-db

Enables **automatic backups** of your Neon database. A new backup every 2 weeks, retained intelligently over time.

## When to use it

{{callout:info|You probably do not need to run this command}}
`/add-backup-db` is run **automatically** at the end of `/add-db`, in the normal flow. You have nothing to do. You should only need to use `/add-backup-db` directly if the backup was skipped for a technical reason (Cloudflare or Neon not configured at the time of `/add-db`).
{{/callout}}

- You added a database via `/add-db` and you want to make sure you have backups (it is actually **enabled automatically** by `/add-db`. You do not need to run `/add-backup-db` by hand in most cases)
- You want to re-run the backup activation on a project where it is broken (missing Neon key, Cloudflare not configured at the time of `/add-db`, etc.)

## How it works

1. **Checks**: Hypervibe verifies that:
  - Wrangler (the Cloudflare CLI) is installed and authenticated
  - You have a **Neon API key** saved (`NEON_API_KEY` in your user environment variables, `/start` takes care of it)
  - A Neon database is actually wired into your project

2. **Deploying the shared Worker**: Hypervibe deploys (or updates) a **shared Cloudflare Worker** called `db-backup`, which lives in `~/.db-backup-worker/` on your computer (outside any repo, because it is shared across all your projects). The Worker is triggered by a Cloudflare cron (1st and 15th of the month at 3am UTC).

3. **Registering the project**: your current project is added to the Worker's `BACKUP_TARGETS` list. The Worker goes through all its targets on each run and creates a Neon backup for each.

4. **Retention policy**: for each project, the Worker maintains an intelligent mix of backups:
  - **Rolling** (the last 2): created on each run, the 2 most recent are always kept
  - **Aging** (up to 3 history points): the most recent backup becomes "aging" every 3 months, and is kept for 9 months max
  - **Total**: 5 Neon branches max per project (out of 20 on the Neon free plan)

## What it creates for you

- A **Cloudflare Worker** `db-backup` (first pass only) deployed on your Cloudflare account. A single Cloudflare "slot" consumed, **even for 50 projects**.
- Your current project **registered** as a target of the Worker
- From now on, your Neon database is backed up every 2 weeks, with no intervention

## Prerequisites

- A Neon database in place (via `/add-db`)
- Neon API key saved (via `/start`)
- Cloudflare connected (via `/start`)

## Tips

{{callout:tip|A single Worker for N projects}}
The genius of this skill: **a single** shared Cloudflare Worker backs up **all** your projects. You can have 30 Neon projects. It still consumes a single Cloudflare "slot" (out of the 5 on the free plan). The Worker runs twice a month and loops over the list.
{{/callout}}

{{callout:warning|To restore a backup}}
If you want to restore a backup, go to **console.neon.tech** → your project → **Branches** tab. There you will see your `backup-rolling-*` and `backup-aging-*` branches with their dates. You can open a branch to inspect it, or promote it as `main` if you want to roll back. If you are unsure how to proceed, ask Claude.
{{/callout}}
