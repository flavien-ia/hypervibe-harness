---
name: _create-render-worker
description: Internal helper invoked by /add-automation once the Render API key is in the vault (Render is driven via its REST API, no CLI) and the project is a monorepo. Creates the apps/worker/ directory with a long-running TypeScript process template, generates render.yaml at the monorepo root, commits and pushes, then guides the user through the manual Render dashboard step (Blueprint creation). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Create Render Worker - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You scaffold a Render Background Worker inside `apps/worker/` and generate the `render.yaml` that lets Render auto-create the service.

The caller (`/add-automation`) has already:
- Ensured the Render API key is in the vault (`_setup-render`) - Render is driven via its REST API (`api.render.com/v1`), no CLI
- Converted the project to a monorepo (`_convert-to-turborepo`)

Render Background Workers are designed for **long-running processes**: queue consumers, polling loops, persistent connections, agents that watch a stream. They are NOT for scheduled tasks (use `/add-cron` for that - Render free tier has no cron support anyway).

---

## Step 1 - Scaffold the worker package

```bash
mkdir -p apps/worker/src
```

Create `apps/worker/package.json`:

```json
{
  "name": "@<project-name>/worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "tsx": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

Replace `<project-name>` with the actual project name read from the root `package.json`.

Create `apps/worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

Create `apps/worker/src/index.ts` with a long-running template:

```typescript
/**
 * Long-running worker entry point.
 *
 * This process is designed to run continuously on Render Background Worker.
 * Replace the main loop below with your actual logic (queue consumer,
 * stream processor, polling loop, persistent agent, etc.).
 */

const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;
let shouldShutdown = false;

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, () => {
    console.log(`[worker] Received ${signal}, shutting down gracefully...`);
    shouldShutdown = true;
  });
}

async function main() {
  console.log("[worker] Started at", new Date().toISOString());

  while (!shouldShutdown) {
    try {
      // TODO: replace with your actual work
      // Examples:
      //   - Poll a queue (Redis, SQS, ...)
      //   - Listen to a stream (websocket, SSE, ...)
      //   - Process pending DB rows
      //   - Run an AI agent loop
      console.log("[worker] tick at", new Date().toISOString());

      // Sleep to avoid burning CPU. Adjust to your use case.
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    } catch (error) {
      console.error("[worker] Error in main loop:", error);
      // Backoff before retrying so we don't spam if there's a persistent error
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }

  console.log("[worker] Shutdown complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
```

Install dependencies:
```bash
pnpm install
```

## Step 2 - Generate render.yaml at the monorepo root

Create `render.yaml` at the **root of the monorepo** (not inside apps/worker/):

```yaml
services:
  - type: worker
    name: <project-name>-worker
    runtime: node
    plan: free
    rootDir: apps/worker
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm start
    envVars:
      - key: NODE_VERSION
        value: "20"
      # Add other env vars here. For secrets, leave the value blank
      # and set them manually in the Render dashboard after the service is created.
```

Replace `<project-name>` with the actual project name.

⚠️ **Important**: we deliberately use `type: worker` and **NOT** `type: cron` - the Render free tier does not support cron jobs. If the user needs scheduling, the caller (`/add-automation`) will run `/add-cron` separately.

## Step 3 - Commit and push

```bash
git add render.yaml apps/worker/
git commit -m "feat: add Render Background Worker"
git push
```

## Step 4 - Guide the user through Blueprint creation

Render does not auto-detect new `render.yaml` files in existing repos - the user must explicitly create a Blueprint from the dashboard.

Tell the user:
> ✅ The worker is scaffolded and the `render.yaml` is committed.
>
> **Manual action required** to create the service on Render:
>
> 1. Go to https://dashboard.render.com
> 2. Click **New** (top right) → **Blueprint**
> 3. Select this repo (`<project-name>`)
> 4. Render will read `render.yaml` and offer to create the `<project-name>-worker` service
> 5. Click **Apply** to confirm
> 6. The worker will deploy automatically (allow ~2-3 minutes)
>
> While it deploys, **if you have any secret environment variables** (API keys, etc.), go into the newly created service → **Environment** → add them manually (Render does not read the repo's `.env`).
>
> Let me know when the deployment is finished.

**Wait for the user to confirm.** Don't move to Step 5 until they say it's done.

## Step 5 - Verify the deployment (Render REST API, no CLI)

Read the Render key from the vault, then list the services:
```bash
K=$(node "${CLAUDE_SKILL_DIR}/../../scripts/vault/vault.mjs" get RENDER api_key)
curl -s -H "Authorization: Bearer $K" "https://api.render.com/v1/services?limit=50"
```

The response is an array of `{ service: {...} }`. Find the object whose `service.name` == `<project-name>-worker` and read `service.id` plus its deployment state (the `serviceDetails`/`suspended` field, or via the latest deploy below).

Check the latest deployment of this service:
```bash
curl -s -H "Authorization: Bearer $K" "https://api.render.com/v1/services/<service-id>/deploys?limit=1"
```
`deploy.status` = `live` → all good. If `build_failed` / `update_failed` / `canceled`, fetch the logs to debug:
```bash
OWNER=$(curl -s -H "Authorization: Bearer $K" "https://api.render.com/v1/owners?limit=1")   # read [0].owner.id
curl -s -H "Authorization: Bearer $K" "https://api.render.com/v1/logs?ownerId=<owner-id>&resource=<service-id>&limit=50"
```
The `logs[]` response has `{ timestamp, message, labels }`. Help the user debug from there.

## Step 6 - Return to caller

Tell the user:
> ✅ Render Background Worker is live.
>
> **Service**: `<project-name>-worker`
> **Code**: `apps/worker/src/index.ts`
> **Dashboard**: https://dashboard.render.com
> **Logs**: via the Render dashboard, or through the API `GET https://api.render.com/v1/logs?ownerId=...&resource=<service-id>`
> **Local dev**: `pnpm --filter=worker dev` (uses tsx watch)
>
> ⚠️ **Free tier**: the worker goes to sleep after **15 minutes of inactivity**. For a worker that truly needs to run 24/7 without interruption, switch to a paid plan ($7/month starter).

Return control to the calling skill (`/add-automation`).
