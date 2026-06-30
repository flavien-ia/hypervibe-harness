// db-backup-worker.js - Cloudflare Worker for automated Neon DB backups
// Shared across all projects. Runs on a cron trigger (1st and 15th of each month).
//
// Config (Cloudflare Worker environment):
//   NEON_API_KEY   - Neon API key (secret, uploaded via `wrangler secret put`)
//   BACKUP_TARGETS - JSON array in [vars]: [{"name":"myapp","projectId":"abc-123"}]
//
// Retention policy (per target):
//   Rolling : 2 branches (latest + previous), rotated every run (~2 weeks)
//   Aging   : 1 new branch created when newest aging > 90 days, deleted after 270 days (9 months)
//   Steady-state max per target: 2 rolling + 3 aging = 5 branches (out of Neon free tier's 20)

const NEON = "https://console.neon.tech/api/v2";

export default {
  async scheduled(_controller, env, ctx) {
    const targets = JSON.parse(env.BACKUP_TARGETS || "[]");
    if (!env.NEON_API_KEY || !targets.length) {
      console.log("No API key or no targets configured - skipping.");
      return;
    }

    const results = await Promise.allSettled(
      targets.map((t) => backup(t, env.NEON_API_KEY)),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        console.error(`[${targets[i].name}] FAILED: ${r.reason?.message || r.reason}`);
      }
    }
  },
};

// ── Neon API helper ─────────────────────────────────────────────────────

async function neon(method, path, key, body) {
  const res = await fetch(`${NEON}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${txt}`);
  }

  return method === "DELETE" ? null : res.json();
}

// ── Helpers ─────────────────────────────────────────────────────────────

function ageInDays(dateStr) {
  return Math.floor(
    (Date.now() - new Date(dateStr + "T00:00:00Z").getTime()) / 86_400_000,
  );
}

// ── Core backup logic (one target) ─────────────────────────────────────

async function backup({ name, projectId }, key) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const R = `bk-${name}-r-`; // rolling prefix
  const A = `bk-${name}-a-`; // aging prefix

  // List all branches for this project
  const { branches } = await neon("GET", `/projects/${projectId}/branches`, key);
  const main = branches.find((b) => b.default);
  if (!main) throw new Error("no default branch found");

  const rolling = branches
    .filter((b) => b.name.startsWith(R))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  const aging = branches
    .filter((b) => b.name.startsWith(A))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  // ── Rolling backup ────────────────────────────────────────────────

  const newR = `${R}${today}`;

  // Create new rolling branch (skip if same-day rerun)
  if (!rolling.find((b) => b.name === newR)) {
    await neon("POST", `/projects/${projectId}/branches`, key, {
      branch: { name: newR, parent_id: main.id },
    });
    console.log(`[${name}] +rolling ${newR}`);
  }

  // Build sorted list including the new one, then delete all except 2 newest
  const allR = [newR, ...rolling.map((b) => b.name).filter((n) => n !== newR)];
  for (const old of allR.slice(2)) {
    const b = branches.find((x) => x.name === old);
    if (b) {
      await neon("DELETE", `/projects/${projectId}/branches/${b.id}`, key);
      console.log(`[${name}] -rolling ${old}`);
    }
  }

  // ── Aging backup ──────────────────────────────────────────────────

  // Create a new aging branch if none exist or the newest is > 90 days old
  const newestAging = aging[0];
  const newestAgingDate = newestAging?.name.replace(A, "");
  const needNewAging = !newestAging || ageInDays(newestAgingDate) > 90;

  if (needNewAging) {
    const newA = `${A}${today}`;
    if (!aging.find((b) => b.name === newA)) {
      await neon("POST", `/projects/${projectId}/branches`, key, {
        branch: { name: newA, parent_id: main.id },
      });
      console.log(`[${name}] +aging ${newA}`);
    }
  }

  // Delete aging branches older than 270 days (9 months)
  for (const old of aging) {
    const d = old.name.replace(A, "");
    if (ageInDays(d) > 270) {
      await neon("DELETE", `/projects/${projectId}/branches/${old.id}`, key);
      console.log(`[${name}] -aging ${old.name}`);
    }
  }

  console.log(`[${name}] ✓ backup cycle complete`);
}
