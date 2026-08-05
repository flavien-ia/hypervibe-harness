---
name: _create-render-worker
description: Internal helper invoked by /add-automation once the Render API key is in the vault (Render is driven via its REST API, no CLI) and the project is a monorepo. Creates the apps/worker/ directory with a background-process template deployed as a Render web service on the free plan (the free instance type does not exist for background workers, and only a web service can receive the HTTP trigger sent by the shared clock), generates render.yaml at the monorepo root, commits and pushes, then guides the user through the manual Render dashboard step (Blueprint creation). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Create Render Worker - Internal helper

## Communication
- Detect the user's language from the conversation (the user's own messages, anywhere in the session - not just this invocation: a bare slash command like `/bootstrap` carries no language signal by itself). If nothing in the conversation gives a signal, fall back to the OS locale (`node -e "console.log(Intl.DateTimeFormat().resolvedOptions().locale)"`) before defaulting to English. ALWAYS reply in that language for every user-facing message: questions, progress, confirmations, summaries, errors - including any example text quoted in this skill, which is illustrative and must be translated, never sent verbatim.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You scaffold a background process inside `apps/worker/` and generate the `render.yaml` that lets Render auto-create the service.

The caller (`/add-automation`) has already:
- Ensured the Render API key is in the vault (`_setup-render`) - Render is driven via its REST API (`api.render.com/v1`), no CLI
- Converted the project to a monorepo (`_convert-to-turborepo`)

## ⚠️ Read this before touching `render.yaml`: it is a **web service**, not a background worker

Render's `free` instance type "is not available for private services, background workers, or cron jobs" (Blueprint spec, verbatim). Only **web services** and static sites accept `plan: free`. So `type: worker` + `plan: free` is a combination that does not exist, and a Blueprint declaring it does not deploy.

The free path is therefore a **web service** (`type: web`), with two consequences that drive the whole template below:

1. **It has to listen on a port.** "Every Render web service must bind to a port on host `0.0.0.0` to serve HTTP requests." Render scans for that port and **fails the deploy** if nothing is listening. A silent polling loop with no server is not deployable.
2. **It sleeps.** Render spins a free web service down after **15 minutes without inbound traffic**, and it takes about a minute to come back. While it sleeps, nothing runs.

That second point is not a defect to work around, it is the shape of the thing. Two regimes, and you pick with the user:

| Regime | How it works | Free instance hours used |
|---|---|---|
| **Woken on demand** (default) | The shared clock (`/add-cron`, Cloudflare) calls `POST /run` at the chosen cadence. The service sleeps in between. | A few hours a month |
| **Kept awake** | A ping every ~10 min holds it up, and the internal loop runs continuously. | ~730 of the 750 monthly hours **for the whole workspace** |

The 750 free instance hours are granted **per workspace per calendar month**, not per service. One service kept awake round the clock therefore consumes essentially the entire allowance, and Render suspends every free service of the workspace once it is spent. Say this to the user before choosing "kept awake".

**When a process genuinely must never stop** (persistent connection, queue consumer that cannot miss a message, an agent watching a stream), the free tier is the wrong answer: switch to a real background worker, `type: worker` + `plan: starter`, around 7 USD/month. That is exactly what `/add-agent` does, and its `templates/agent/render.yaml` is the reference.

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

Create `apps/worker/src/index.ts`. The work itself lives in `runOnce()`; everything around it exists so the process is deployable and triggerable:

```typescript
/**
 * Background process, deployed as a Render **web service** on the free plan.
 *
 * Why a web service and not a background worker: Render's free instance type is
 * not available for background workers. A web service therefore has to listen
 * on a port, and Render fails the deploy if nothing does.
 *
 * Two ways to drive the work, and you only need one:
 *   - the shared clock calls POST /run (the service sleeps in between);
 *   - LOOP_INTERVAL_MS is set and the service is kept awake by a regular ping.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 10000);
const RUN_TOKEN = process.env.RUN_TOKEN ?? "";
// 0 disables the internal loop, which is the right default when the shared
// clock drives the work: a loop inside a sleeping service runs nowhere.
const LOOP_INTERVAL_MS = Number(process.env.LOOP_INTERVAL_MS ?? 0);

let running = false;
let lastRunAt: string | null = null;
let lastError: string | null = null;

/** One pass of actual work. This is the only part you replace. */
async function runOnce(): Promise<void> {
  // TODO: your actual work
  //   - drain a queue, process pending DB rows,
  //   - call an external API and store the result...
  console.log("[worker] run at", new Date().toISOString());
}

/**
 * Serialised: a burst of triggers must never overlap two passes. Answering
 * "busy" is a truthful outcome, not an error, so the caller can just retry.
 */
async function runGuarded(): Promise<"ok" | "busy"> {
  if (running) return "busy";
  running = true;
  try {
    await runOnce();
    lastRunAt = new Date().toISOString();
    lastError = null;
    return "ok";
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("[worker] run failed:", error);
    throw error;
  } finally {
    running = false;
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // What Render's port scan hits, and what a keep-alive ping hits.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", running, lastRunAt, lastError }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/run") {
    if (!RUN_TOKEN || req.headers.authorization !== `Bearer ${RUN_TOKEN}`) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    // Answer before the work finishes: a caller that waits would time out on
    // anything slow, and the shared clock does not need the result.
    void runGuarded()
      .then((outcome) => res.writeHead(outcome === "busy" ? 409 : 202).end(outcome))
      .catch(() => res.writeHead(500).end("run failed"));
    return;
  }

  res.writeHead(404).end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[worker] listening on ${PORT}`);
  if (LOOP_INTERVAL_MS > 0) {
    console.log(`[worker] internal loop every ${LOOP_INTERVAL_MS} ms`);
    setInterval(() => {
      void runGuarded().catch(() => undefined);
    }, LOOP_INTERVAL_MS);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, closing`);
    server.close(() => process.exit(0));
  });
}
```

Install dependencies:
```bash
pnpm install
```

## Step 2 - Generate render.yaml at the monorepo root

Create `render.yaml` at the **root of the monorepo** (not inside apps/worker/):

```yaml
services:
  - type: web
    name: <project-name>-worker
    runtime: node
    plan: free
    rootDir: apps/worker
    buildCommand: pnpm install && pnpm build
    startCommand: pnpm start
    healthCheckPath: /healthz
    envVars:
      - key: NODE_VERSION
        value: "20"
      # Shared secret guarding POST /run. generateValue lets Render mint it, so
      # it never transits the conversation. Read it back from the dashboard (or
      # the API) when wiring the clock.
      - key: RUN_TOKEN
        generateValue: true
      # Set only if the user chose the "kept awake" regime, e.g. 300000 for 5 min.
      # - key: LOOP_INTERVAL_MS
      #   value: "300000"
      # Add other env vars here. For secrets, leave the value blank
      # and set them manually in the Render dashboard after the service is created.
```

Replace `<project-name>` with the actual project name.

⚠️ **`type: web`, not `worker`, and not `cron`.** The reasons are in the block at the top of this skill: `plan: free` exists for neither `worker` nor `cron`, and only a web service can receive the HTTP call the shared clock sends. Do not "simplify" this back to `type: worker` while keeping `plan: free` - that Blueprint does not deploy.

Scheduling still belongs to `/add-cron` (the shared Cloudflare clock), which the caller runs separately and points at `POST /run`.

### Variant - the process must genuinely never stop

Only when the discovery established it: a persistent websocket, a queue consumer that cannot drop a message, an agent watching a stream. Then it is a real background worker, and **three things change together**, not one:

- `type: worker` and `plan: starter` in `render.yaml` (around 7 USD/month). Drop `healthCheckPath` and `RUN_TOKEN`.
- **Remove the HTTP server from the template.** A background worker exposes no port, so `createServer` has nothing to bind and `POST /run` cannot exist. Keep `runOnce()` and `runGuarded()`, and drive them from a `setInterval` (or a real queue subscription) started at boot.
- **No `/add-cron` afterwards.** The process is its own clock; a shared clock has nothing to call.

Announce the monthly cost **before** applying this, and never fall into it by default. A user who wanted an automation and discovers a subscription afterwards is a user who stops trusting the tool.

## Step 3 - Commit and push

```bash
git add render.yaml apps/worker/
git commit -m "feat: add background worker on Render"
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
> ✅ Your background process is live on Render, free plan.
>
> **Service**: `<project-name>-worker`
> **Code**: `apps/worker/src/index.ts` (your work goes in `runOnce()`)
> **Trigger**: `POST /run`, with the `RUN_TOKEN` header. `GET /healthz` says how the last run went.
> **Dashboard**: https://dashboard.render.com
> **Logs**: via the Render dashboard, or through the API `GET https://api.render.com/v1/logs?ownerId=...&resource=<service-id>`
> **Local dev**: `pnpm --filter=worker dev` (uses tsx watch)
>
> ⚠️ **What the free plan means here**: the service goes to sleep after 15 minutes without a call, and takes about a minute to wake up on the next one. That is fine for work triggered on a schedule, and it is why the clock calls it rather than the other way round. If your process has to run without ever stopping, tell me: that is a real background worker, around 7 USD/month, and it is a two-line change.

Then read the generated `RUN_TOKEN` (Render dashboard → the service → Environment, or `GET /v1/services/<id>/env-vars` on the API) and hand it to `/add-cron` so the clock can authenticate. Never print it in the conversation.

Return control to the calling skill (`/add-automation`).
