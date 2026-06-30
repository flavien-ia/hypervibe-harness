---
name: _convert-to-turborepo
description: Internal helper to convert a single Next.js project into a Turborepo monorepo. Idempotent - if the project is already a monorepo (apps/web/ exists), returns immediately. Moves the existing project into apps/web/, creates root package.json with workspaces, pnpm-workspace.yaml, turbo.json, and adds turbo as a dev dependency. Optionally extracts a shared packages/db package if a Drizzle DB is detected. Updates imports in apps/web accordingly. Triggered by /add-automation. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Convert to Turborepo - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Convert a single Next.js project into a Turborepo monorepo. Idempotent - if already a monorepo, return immediately.

---

## Step 1 - Idempotency check

```bash
test -d apps/web && echo "already-monorepo" || echo "single-app"
```

If `already-monorepo`, tell the user:
> The project is already a Turborepo monorepo. There is nothing for me to do.

Return control to the caller immediately. **Skip all remaining steps.**

If `single-app`, continue to Step 2.

## Step 2 - Capture state and warn the user

Read the current project name from `package.json`:
```bash
node -e "process.stdout.write(require('./package.json').name)"
```

Detect if a Drizzle DB is configured:
```bash
test -f drizzle.config.ts -o -f drizzle.config.js && echo "has-db" || echo "no-db"
```

Tell the user:
> I am going to convert your project into a Turborepo monorepo: the current code moves to `apps/web/`, with a new root `package.json` + `pnpm-workspace.yaml` + `turbo.json`, and turbo added as a devDep<if has-db>, plus the Drizzle DB extracted into `packages/db/`</if>.
>
> ⚠️ **Commit your work in progress first** - this operation moves a lot of files and is hard to revert.
>
> Ready to go? (reply `yes` to continue)

Wait for confirmation. Don't start without it.

## Step 3 - Verify clean working tree

```bash
git status --porcelain
```

If there are uncommitted changes, refuse:
> ❌ You have uncommitted changes. Commit or stash them first, then re-run `/add-automation`.

Return to caller without doing anything.

## Step 4 - Move the project into apps/web/

```bash
mkdir -p apps/web
```

Move everything **except** `apps/`, `.git`, `node_modules`, and lock files. Use `git mv` to preserve history (fall back to `mv` if git mv fails on ignored files).

```bash
shopt -s dotglob nullglob
for item in *; do
  case "$item" in
    apps|.git|node_modules|pnpm-lock.yaml|package-lock.json|yarn.lock) continue ;;
    *) git mv "$item" "apps/web/$item" ;;
  esac
done
test -f pnpm-lock.yaml && mv pnpm-lock.yaml apps/web/pnpm-lock.yaml
rm -rf node_modules   # we'll reinstall at the end
```

## Step 5 - Create root package.json

```bash
cat > package.json <<'EOF'
{
  "name": "<project-name>-monorepo",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  },
  "packageManager": "pnpm@9.0.0"
}
EOF
```

Replace `<project-name>` with the actual name from the original `package.json`.

## Step 6 - Create pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

## Step 7 - Create turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {}
  }
}
```

## Step 8 - Extract DB to packages/db/ (if has-db)

**Skip this step if `no-db`.**

If `has-db`:

```bash
mkdir -p packages/db
```

Move the Drizzle config and schema (the `git mv` renames `db/` to `packages/db/src/`, so `packages/db/src` must not pre-exist):
```bash
git mv apps/web/drizzle.config.ts packages/db/drizzle.config.ts
git mv apps/web/src/server/db packages/db/src
```

Create `packages/db/package.json`:

```json
{
  "name": "@<project-name>/db",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

Create `packages/db/tsconfig.json`:
```json
{
  "extends": "../../apps/web/tsconfig.json",
  "include": ["src/**/*", "drizzle.config.ts"]
}
```

Make sure `packages/db/src/index.ts` exists and re-exports the Drizzle client:
```typescript
export * from "./schema";
// Adjust depending on what was in src/server/db originally
```

### 8a - Update imports in apps/web

Find all files in `apps/web` that import from `~/server/db` or `@/server/db` and rewrite them to `@<project-name>/db`:

```bash
cd apps/web
grep -rln "from \"~/server/db" src/ | xargs sed -i 's|from "~/server/db|from "@<project-name>/db|g'
grep -rln "from \"@/server/db" src/ | xargs sed -i 's|from "@/server/db|from "@<project-name>/db|g'
```

Be careful: only rewrite the exact `~/server/db` and `@/server/db` prefixes, not other things.

### 8b - Add the dependency in apps/web/package.json

Add to `apps/web/package.json`:
```json
{
  "dependencies": {
    "@<project-name>/db": "workspace:*"
  }
}
```

## Step 9 - Reinstall dependencies

```bash
pnpm install
```

This will create a fresh `pnpm-lock.yaml` at the root and install everything across the workspace.

## Step 10 - Verify the conversion

```bash
pnpm dev --filter=web
```

Wait a few seconds. If Next.js starts on port 3000 without errors, kill it (Ctrl+C). The conversion is successful.

If it errors:
- **Module not found** errors → an import wasn't rewritten in Step 8a. Find and fix.
- **Lockfile errors** → `rm -rf node_modules apps/*/node_modules packages/*/node_modules pnpm-lock.yaml && pnpm install`

## Step 11 - Commit

```bash
git add .
git commit -m "refactor: convert to Turborepo monorepo"
```

⚠️ **Don't push automatically** - let the caller (`/add-automation`) decide when to push.

## Step 12 - Return to caller

Tell the user:
> ✅ Conversion to a Turborepo monorepo complete. Your app now lives in `apps/web/`<if has-db>, and your shared DB in `packages/db/`</if>.
>
> New commands: `pnpm dev` (all apps), `pnpm dev --filter=web` (just the frontend), `pnpm build`.
>
> Commit made locally, not pushed - the caller will decide when to push.

Return control to the calling skill (`/add-automation`).
