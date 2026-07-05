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
  - Your **Neon API key** is saved on your computer (`/start` takes care of it)
  - A Neon database is actually wired into your project

2. **Your shared clock**: Hypervibe makes sure your **shared clock** is in place: a single mutualized Cloudflare mechanism (`hypervibe-jobs`) that serves all your projects (scheduled tasks, database backups, quota watch). It lives in `~/.hypervibe-jobs/` on your computer, versioned with git, so every change to it leaves a trace.

3. **Registering the project**: your current project is added to the targets of the clock's **backup job**. The updated list is saved (a small git commit) and the clock redeployed. On the 1st and the 15th of the month at 3am UTC, the job goes through all its targets and creates a Neon backup for each.

4. **Retention policy**: for each project, the backup job maintains an intelligent mix of backups:
  - **Rolling** (the last 2): created on each run, the 2 most recent are always kept
  - **Aging** (up to 3 history points): a new checkpoint roughly every 3 months, kept for 9 months max
  - **Total**: 5 Neon branches max per project (out of 20 on the Neon free plan)

## What it creates for you

- The **backup job** on your shared clock (created the first time; later projects simply join it)
- Your current project **registered** as a target of that job
- From now on, your Neon database is backed up every 2 weeks, with no intervention
- A single Cloudflare cron slot consumed **in total**, shared with your scheduled tasks and your quota watch, even for 50 projects

## Prerequisites

- A Neon database in place (via `/add-db`)
- Neon API key saved (via `/start`)
- Cloudflare connected (via `/start`)

## Tips

{{callout:tip|One clock for all your projects}}
The backups no longer have their own dedicated machinery: they are one job among others on your **shared clock**, the single mutualized mechanism that also runs your scheduled tasks and your quota watch. You can have 30 Neon projects: it still consumes a single Cloudflare cron slot in total. And since the list of what gets backed up is versioned (git) on your computer, you can always see what changed, and when.
{{/callout}}

{{callout:warning|To restore a backup}}
If you want to restore a backup, go to **console.neon.tech** → your project → **Branches** tab. There you will see your backup branches with their dates: `bk-<project>-r-*` for the rolling ones, `bk-<project>-a-*` for the quarterly checkpoints. You can open a branch to inspect it, or promote it as `main` if you want to roll back. If you are unsure how to proceed, ask Claude.
{{/callout}}
