---
name: _create-cloudflare-worker
description: Internal helper invoked by /add-automation once Wrangler is installed and the project is a monorepo. Creates the apps/worker/ directory, scaffolds a Cloudflare Worker via wrangler init, optionally adds CRON triggers natively in wrangler.toml, implements scheduled+fetch handlers, and deploys. Returns the deployed worker URL. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---


## ⚠️ Before any call to `wrangler` (to be done BEFORE any other wrangler command in this skill)

```bash
eval "$(node "${CLAUDE_SKILL_DIR}/../../scripts/wrangler-env-init.mjs")"
```

This line loads `CLOUDFLARE_API_TOKEN` from the User scope (Windows registry / shell rc on Mac/Linux) if it is not in `process.env`, and adds the pnpm bin to the PATH (for bash sessions where `pnpm setup` has not yet propagated). Without it, `wrangler` fails with "command not found" on Mac (Spotlight), or may use a different Cloudflare account than the one the user expects.


# Create Cloudflare Worker - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You scaffold and deploy a Cloudflare Worker inside `apps/worker/`.

The caller (`/add-automation`) has already:
- Verified Wrangler is installed and authenticated (`_setup-wrangler`)
- Converted the project to a monorepo (`_convert-to-turborepo`)
- Decided whether the worker needs CRON triggers, and provided the cron expression if so

If any of these are not true, refuse and tell the user to invoke `/add-automation` instead.

The caller passes (or will tell you) two parameters:
- `NEEDS_CRON` - `yes` or `no`
- `CRON_EXPRESSION` - a standard 5-field cron expression (only if `NEEDS_CRON=yes`)

---

## Step 1 - Scaffold the worker

```bash
mkdir -p apps/worker
cd apps/worker
pnpm dlx wrangler init . --yes
```

This creates a minimal Worker template with `wrangler.toml`, `src/index.ts`, and a `package.json`.

## Step 2 - Configure wrangler.toml

Read the project name from the root `package.json`:
```bash
node -e "process.stdout.write(require('../../package.json').name)"
```

Read the Cloudflare account ID:
```bash
wrangler whoami | grep -oE '[a-f0-9]{32}' | head -1
```

Update `apps/worker/wrangler.toml` with:
```toml
name = "<project-name>-worker"
main = "src/index.ts"
compatibility_date = "<today's date in YYYY-MM-DD>"
account_id = "<account id>"
```

### If NEEDS_CRON=yes - add cron triggers

Append to `wrangler.toml`:
```toml

[triggers]
crons = ["<CRON_EXPRESSION>"]
```

## Step 3 - Implement the handlers

Replace `apps/worker/src/index.ts` with:

### If NEEDS_CRON=yes (both fetch + scheduled handlers)

```typescript
export interface Env {
  // Add your environment variables here, e.g.:
  // SOME_API_KEY: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // TODO: your scheduled task logic here
    console.log("Cron triggered:", event.cron, "at", new Date().toISOString());
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("Worker is running", { status: 200 });
  },
};
```

### If NEEDS_CRON=no (just fetch handler)

```typescript
export interface Env {
  // Add your environment variables here
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // TODO: handle incoming requests
    return new Response("Worker is running", { status: 200 });
  },
};
```

## Step 4 - Add scripts to apps/worker/package.json

Make sure `apps/worker/package.json` has:
```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail"
  }
}
```

## Step 5 - Deploy

```bash
cd apps/worker
wrangler deploy
```

Capture the deployed URL from the output (looks like `https://<project-name>-worker.<your-subdomain>.workers.dev`).

If the deploy fails:
- **Account ID error** → re-run `wrangler whoami` and verify it's set in `wrangler.toml`
- **Already exists** → that's fine, it's an update; the URL stays the same
- **Quota exceeded** → tell the user they may be near the 100k req/day free limit on another worker

## Step 6 - Add the worker URL as an env var

So the Next.js app can call the worker via HTTP, invoke `_push-env-vars` with:
- `WORKER_URL=<worker URL from Step 5>`

The helper writes to `.env` local AND pushes to Vercel (production/preview/development) in one operation.

## Step 7 - Return to caller

Tell the user:
> ✅ Cloudflare Worker deployed.
>
> **URL**: `<worker URL>`
> **Code**: `apps/worker/src/index.ts`
> **Real-time logs**: `pnpm --filter=worker tail`
> **Local dev**: `pnpm --filter=worker dev`

If `NEEDS_CRON=yes`, also tell the user:
> The CRON is handled natively by Cloudflare via `[triggers]` in `wrangler.toml`. Current schedule: `<CRON_EXPRESSION>`. To change it, edit `wrangler.toml` and redeploy.

Return control to the calling skill (`/add-automation`). Pass back the worker URL so the orchestrator can include it in its final summary.
