// cron-dispatcher-worker.js - Cloudflare Worker that dispatches scheduled HTTP pings.
//
// Shared across ALL projects on this Cloudflare account. Runs every minute and
// triggers the tasks whose 5-field UTC cron expression matches the current minute.
// Uses a single Cloudflare cron slot regardless of how many tasks are registered.
//
// Config (Cloudflare Worker environment):
//   TASKS - JSON array in [vars]:
//     [{
//       "name": "weekly-report",          // unique key, used in logs
//       "cron": "0 8 * * 1",              // 5-field cron, UTC
//       "url":  "https://app.com/api/cron/weekly-report",
//       "secretName": "CRON_SECRET_APP",  // name of the wrangler secret holding the bearer
//       "project": "myapp"                // (informative) project this task belongs to
//     }, ...]
//   <secretName> - bearer token for each project, uploaded via `wrangler secret put`.
//                  Multiple tasks of the same project share one secret.

export default {
  async scheduled(_controller, env, ctx) {
    const tasks = parseTasks(env.TASKS);
    if (!tasks.length) {
      console.log("No tasks configured - skipping.");
      return;
    }

    const now = new Date();
    const due = tasks.filter((t) => safeCronMatch(t, now));

    if (!due.length) {
      console.log(`No task due at ${now.toISOString()}.`);
      return;
    }

    console.log(`Dispatching ${due.length} task(s): ${due.map((t) => t.name).join(", ")}`);
    for (const task of due) {
      ctx.waitUntil(runTask(task, env));
    }
  },

  // Optional fetch handler for manual triggering (debugging only).
  async fetch(req, env, ctx) {
    if (req.method !== "POST") return new Response("Use POST /trigger?name=<task>", { status: 405 });
    const url = new URL(req.url);
    const name = url.searchParams.get("name");
    if (!name) return new Response("Missing ?name=", { status: 400 });

    const tasks = parseTasks(env.TASKS);
    const task = tasks.find((t) => t.name === name);
    if (!task) return new Response(`Unknown task "${name}"`, { status: 404 });

    ctx.waitUntil(runTask(task, env));
    return new Response(`Triggered "${name}"`, { status: 202 });
  },
};

function parseTasks(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error(`TASKS parse error: ${err.message}`);
    return [];
  }
}

function safeCronMatch(task, date) {
  try {
    return cronMatches(task.cron, date);
  } catch (err) {
    console.error(`[${task.name}] invalid cron "${task.cron}": ${err.message}`);
    return false;
  }
}

async function runTask(task, env) {
  const secret = task.secretName ? env[task.secretName] : null;
  if (!secret) {
    console.error(`[${task.name}] missing secret "${task.secretName}" - skipping.`);
    return;
  }

  const started = Date.now();
  try {
    const res = await fetch(task.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        "User-Agent": "cron-dispatcher/1.0",
      },
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const body = await res.text();
      console.error(`[${task.name}] ${res.status} in ${ms}ms: ${body.slice(0, 200)}`);
    } else {
      console.log(`[${task.name}] ✓ ${res.status} in ${ms}ms`);
    }
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`[${task.name}] FAILED in ${ms}ms: ${err.message || err}`);
  }
}

// ── Cron matcher (5-field UTC: minute hour dom month dow) ────────────────

function cronMatches(expr, date) {
  if (typeof expr !== "string") throw new Error("not a string");
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`expected 5 fields, got ${parts.length}`);
  const [m, h, dom, mon, dow] = parts;

  const timeOk =
    matchField(date.getUTCMinutes(), m, 0, 59) &&
    matchField(date.getUTCHours(), h, 0, 23) &&
    matchField(date.getUTCMonth() + 1, mon, 1, 12);
  if (!timeOk) return false;

  const domOk = matchField(date.getUTCDate(), dom, 1, 31);
  const dowOk = matchField(normalizeDow(date.getUTCDay()), dow, 0, 6);
  // POSIX cron: when BOTH day-of-month and day-of-week are restricted (neither is
  // "*"), the day matches if EITHER field matches (OR). Otherwise AND applies.
  const domRestricted = dom.trim() !== "*";
  const dowRestricted = dow.trim() !== "*";
  return domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
}

// Cron uses 0-6 with 0=Sunday; JS getUTCDay() also returns 0=Sunday so no shift needed.
function normalizeDow(d) {
  return d;
}

function matchField(value, field, min, max) {
  for (const part of field.split(",")) {
    if (matchPart(value, part.trim(), min, max)) return true;
  }
  return false;
}

function matchPart(value, part, min, max) {
  if (part === "*") return true;

  let range = part;
  let step = 1;
  if (part.includes("/")) {
    const [r, s] = part.split("/");
    range = r;
    step = Number(s);
    if (!Number.isFinite(step) || step <= 0) return false;
  }

  let from;
  let to;
  if (range === "*") {
    from = min;
    to = max;
  } else if (range.includes("-")) {
    const [a, b] = range.split("-").map(Number);
    from = a;
    to = b;
  } else {
    from = Number(range);
    to = step === 1 ? from : max;
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (value < from || value > to) return false;
  return (value - from) % step === 0;
}
