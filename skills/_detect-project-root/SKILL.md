---
name: _detect-project-root
description: Internal helper to detect the basic structure of the current project (project name, monorepo vs single app, web directory path, Next.js detection). Returns a minimal set of 4 variables that most add-* skills need at the very beginning of their execution. Idempotent and fast. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Detect Project Root - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You detect the basic structure of the current project and return a minimal set of variables that the caller can reuse. You work silently, without bothering the user unless the project cannot be detected.

---

## What this helper returns

A 4-variable snapshot:

| Variable | Possible values | Used by |
|---|---|---|
| `PROJECT_NAME` | `my-app`, `hypervibe`, etc. | Everything: R2 bucket names, workers, monorepo packages, `render.yaml`, etc. |
| `WEB_DIR` | `.` (single app) or `apps/web` (monorepo) | add-db, add-cron, add-auth, _create-*-worker |
| `IS_MONOREPO` | `yes` / `no` | add-automation, add-db, _create-cloudflare-worker, _create-render-worker |
| `IS_NEXTJS` | `yes` / `no` | All add-* skills (to refuse if the project is not Next.js) |

**This is intentionally minimal.** Specific checks like `HAS_DB`, `HAS_AUTH`, `HAS_RESEND` remain inline in the skills that need them - they are contextual and shouldn't pollute every skill's context.

---

## Step 1 - Detect monorepo vs single app

```bash
test -d apps/web && echo "monorepo" || echo "single"
```

Set `IS_MONOREPO` accordingly:
- `monorepo` → `IS_MONOREPO=yes`, `WEB_DIR=apps/web`
- `single` → `IS_MONOREPO=no`, `WEB_DIR=.`

## Step 2 - Read the project name

For **single app** (`WEB_DIR=.`):
```bash
node -e "process.stdout.write(require('./package.json').name)"
```

For **monorepo** (`WEB_DIR=apps/web`):
- Try the root `package.json` first (Bootstrap's convention is that the root package has the "real" project name):
  ```bash
  node -e "process.stdout.write(require('./package.json').name)"
  ```
- If the root name contains `-monorepo` suffix (e.g. `hypervibe-monorepo`), strip it to get the logical project name.
- Fallback: read `apps/web/package.json` if root is missing.

Set `PROJECT_NAME`.

## Step 3 - Verify Next.js

```bash
node -e "const p=require('./WEB_DIR/package.json'); process.stdout.write(p.dependencies?.next || p.devDependencies?.next || 'none')"
```

Replace `WEB_DIR` with the detected value. If the output is `none`, set `IS_NEXTJS=no`. Otherwise `IS_NEXTJS=yes`.

## Step 4 - Sanity check

If `PROJECT_NAME` is empty or `IS_NEXTJS=no`:

Tell the user:
> I cannot detect a Next.js project in the current folder. Check that:
> - You are at the root of the project (or in `apps/web` / another T3 folder)
> - A `package.json` exists and lists `next` as a dependency
>
> If this is a new project, run `/bootstrap` first.

Then return an error state to the caller (so it can abort).

## Step 5 - Return the snapshot

Report to the caller in this exact format so it can parse the values:

```
PROJECT_NAME=<value>
WEB_DIR=<value>
IS_MONOREPO=<yes|no>
IS_NEXTJS=<yes|no>
```

Example success output:
```
PROJECT_NAME=hypervibe
WEB_DIR=apps/web
IS_MONOREPO=yes
IS_NEXTJS=yes
```

The caller reads these 4 lines and uses them throughout its own execution without having to redetect anything.

---

## When to invoke this helper

Every `add-*` skill should call this in Step 1 (or wherever it currently does `test -f package.json`), **replacing** the ad-hoc detection code. The invocation is a single line:

> Invoke `_detect-project-root` to get PROJECT_NAME, WEB_DIR, IS_MONOREPO, IS_NEXTJS.

The helper is **idempotent** - calling it multiple times in the same session is fine (it just re-reads the filesystem).

## What this helper does NOT detect

These checks remain inline in the skills that need them, because they are contextual and used by only 1-2 skills each:

- `HAS_REAL_DB` - **mandatory robust check** (used by `add-auth`, `add-backup-db`, and any skill that needs a real cloud DB): (1) `DATABASE_URL` present in `.env`, AND (2) its value does not point to local and is not a placeholder - reject if the value matches `@localhost:` / `@127\.0\.0\.1:` / `placeholder` / `//postgres:postgres@` / `YOUR_DB` (bootstrapped T3 projects ship a default like `postgresql://postgres:password@localhost:5432/test` that passes Zod validation but is not wired up), AND (3) a `drizzle.config.ts`/`.js` exists (root, `apps/web/`, or `packages/db/`). NEVER rely on `grep DATABASE_URL .env` alone - guaranteed false positives.
- `HAS_AUTH` - check `src/server/auth.ts` → only used by `add-google-auth`, `add-github-auth`
- `HAS_RESEND` / `HAS_BREVO` - check API key presence → only used by `add-domain`
- `VERCEL_LINKED` - check `.vercel/project.json` → only used by `_setup-github-deploy`, `add-domain`, `_push-env-vars`

Do not try to add these to `_detect-project-root`. The helper stays minimal.
