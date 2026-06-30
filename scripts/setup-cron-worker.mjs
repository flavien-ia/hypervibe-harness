#!/usr/bin/env node
// setup-cron-worker.mjs - Scaffold a Cloudflare Worker cron trigger + the
// matching Next.js /api/cron/<task-name> route for a single scheduled task.
//
// Usage:
//   node setup-cron-worker.mjs \
//     --task-name daily-report \
//     --cron-expr "0 9 * * *" \
//     --app-url https://myapp.vercel.app \
//     --project-name my-app \
//     [--web-dir .]
//
// What it creates:
//   1. <web-dir>/src/app/api/cron/<task-name>/route.ts
//      Next.js GET handler, CRON_SECRET bearer-token check, placeholder body.
//   2. cron-workers/<task-name>/wrangler.toml
//      Worker name + cron trigger + APP_URL + CRON_ENDPOINT vars.
//   3. cron-workers/<task-name>/index.ts
//      Worker entry that fetches the endpoint with the bearer token.
//
// What it does NOT do (Claude / user handles):
//   - Generate / push CRON_SECRET (use _generate-secret + _push-env-vars first).
//   - Upload CRON_SECRET to Cloudflare: `npx wrangler secret put CRON_SECRET`.
//   - Deploy: `cd cron-workers/<task-name> && npx wrangler deploy`.
//   - Replace the // YOUR CRON LOGIC HERE placeholder with real business logic.
//
// Idempotency: refuses to overwrite an existing cron-workers/<task-name>/ dir.
// Delete it manually if you want to regenerate from scratch.

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ─── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let taskName = "";
let cronExpr = "";
let appUrl = "";
let projectName = "";
let webDir = ".";

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--task-name" && args[i + 1]) taskName = args[++i];
  else if (a === "--cron-expr" && args[i + 1]) cronExpr = args[++i];
  else if (a === "--app-url" && args[i + 1]) appUrl = args[++i];
  else if (a === "--project-name" && args[i + 1]) projectName = args[++i];
  else if (a === "--web-dir" && args[i + 1]) webDir = args[++i];
  else {
    console.error(`Unknown arg: ${a}`);
    process.exit(1);
  }
}

if (!taskName || !cronExpr || !appUrl || !projectName) {
  console.error(
    "Usage: node setup-cron-worker.mjs --task-name NAME --cron-expr EXPR " +
      "--app-url URL --project-name NAME [--web-dir .]",
  );
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(taskName)) {
  console.error(`--task-name must be kebab-case. Got: ${taskName}`);
  process.exit(1);
}

// ─── refuse to overwrite an existing worker dir ───────────────────────
const workerDir = join("cron-workers", taskName);
if (existsSync(workerDir)) {
  console.error(
    `❌ ${workerDir} already exists. Delete it first if you want to regenerate.`,
  );
  process.exit(1);
}

// ─── 1. <web-dir>/src/app/api/cron/<task-name>/route.ts ──────────────
const routeDir = join(webDir, "src/app/api/cron", taskName);
mkdirSync(routeDir, { recursive: true });
const routePath = join(routeDir, "route.ts");
writeFileSync(
  routePath,
  `import { NextResponse } from "next/server";

export async function GET(req: Request) {
  // Verify the request comes from our Cloudflare Worker.
  const authHeader = req.headers.get("authorization");
  const expected = \`Bearer \${process.env.CRON_SECRET}\`;

  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ── YOUR CRON LOGIC HERE (${taskName}) ──
    // Example: await sendDailyReport();
    console.log(\`[CRON:${taskName}] Executed at \${new Date().toISOString()}\`);

    return NextResponse.json({
      success: true,
      task: "${taskName}",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[CRON:${taskName}] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
`,
);
console.log(`✓ ${routePath}`);

// ─── 2. cron-workers/<task-name>/wrangler.toml ───────────────────────
mkdirSync(workerDir, { recursive: true });
const wranglerPath = join(workerDir, "wrangler.toml");
writeFileSync(
  wranglerPath,
  `name = "${projectName}-cron-${taskName}"
main = "index.ts"
compatibility_date = "2024-01-01"

[triggers]
crons = ["${cronExpr}"]

[vars]
APP_URL = "${appUrl}"
CRON_ENDPOINT = "/api/cron/${taskName}"
`,
);
console.log(`✓ ${wranglerPath}`);

// ─── 3. cron-workers/<task-name>/index.ts ────────────────────────────
const workerEntryPath = join(workerDir, "index.ts");
writeFileSync(
  workerEntryPath,
  `export default {
  async scheduled(
    controller: ScheduledController,
    env: { APP_URL: string; CRON_ENDPOINT: string; CRON_SECRET: string },
    ctx: ExecutionContext,
  ): Promise<void> {
    const url = \`\${env.APP_URL}\${env.CRON_ENDPOINT}\`;

    ctx.waitUntil(
      fetch(url, {
        method: "GET",
        headers: { Authorization: \`Bearer \${env.CRON_SECRET}\` },
      }).then(async (res) => {
        if (!res.ok) {
          console.error(\`Cron failed: \${res.status} \${await res.text()}\`);
        } else {
          console.log(\`Cron success: \${res.status}\`);
        }
      }),
    );
  },
};
`,
);
console.log(`✓ ${workerEntryPath}`);

console.log(`
✅ Cron worker scaffold ready for task "${taskName}":
   - Route:  ${routePath}
   - Worker: ${workerDir}/

Next steps (still to run manually):
   1. cd ${workerDir}
   2. echo "<CRON_SECRET value>" | npx wrangler secret put CRON_SECRET
   3. npx wrangler deploy
`);
