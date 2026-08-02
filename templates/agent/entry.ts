// agent/entry.ts - Long-running entry point for the Render Background Worker.
//
// Two trigger sources, both feeding into runAgent():
//   1. Internal cron (via node-cron)            - scheduled runs
//   2. DB queue polling (ADAPTIVE cadence)      - manual triggers from dashboard
//                                                  (or any backend code that
//                                                   inserts into agent_trigger_queue)
//
// Why polling instead of an HTTP endpoint?
//   - Render Background Worker doesn't expose ports (Web Service does, but
//     sleeps after 15 min on free tier - bad for an agent that must respond
//     within a few seconds to manual triggers).
//   - Polling a DB queue is simple, reliable, no public surface to attack.
//     The "trigger now" button in the dashboard just inserts a row and gets
//     a row id back.
//
// Why ADAPTIVE cadence (burst 5 s / idle 10 min) instead of a fixed 5 s?
//   Every poll wakes the Neon compute, and Neon only autosuspends after
//   5 min WITHOUT a query. A fixed 5 s loop therefore keeps the database
//   awake 24/7: ~186 CU-hours/month at 0.25 CU, i.e. nearly twice the free
//   plan's 100 CU-h/project budget - the agent alone kills the quota. With
//   burst/idle, the loop is snappy right after any activity (a found
//   trigger, a finished run, boot) and slow the rest of the time, letting
//   the database sleep between bursts (~50 % duty cycle worst case, far
//   less in practice). The trade-off is that an isolated manual trigger can
//   wait up to POLL_IDLE_MS before pickup; the dashboard shows "queued".
//   If the project already has a Redis (Upstash), a cheaper design is to
//   poll a Redis wake-flag every 10 s (set by the dashboard alongside the
//   DB row) and only touch Neon when the flag is up.
//
// Lifecycle:
//   - On boot: register the cron schedule (if AGENT_CRON_SCHEDULE is set)
//   - Loop forever: poll queue, run any pending triggers, sleep (adaptive)
//   - On SIGTERM (Render restart): finish in-flight invocations, exit clean

import cron from "node-cron";
import { db } from "./db.js";
import { agentTriggerQueue } from "./schema.js";
import { eq } from "drizzle-orm";
import { runAgent } from "./loop.js";

// Cadence adaptative (voir l'en-tête) : rapide juste après une activité,
// lente au repos pour laisser la base Neon s'autosuspendre.
const POLL_ACTIVE_MS = 5_000;            // burst : réactif pendant la fenêtre d'activité
const POLL_IDLE_MS = 600_000;            // repos : 10 min, la base peut dormir entre deux polls
const ACTIVITY_WINDOW_MS = 5 * 60_000;   // durée du burst après la dernière activité
const AGENT_CRON_SCHEDULE = process.env.AGENT_CRON_SCHEDULE; // e.g. "0 7 * * *" - optional
const AGENT_CRON_PROMPT = process.env.AGENT_CRON_PROMPT;     // prompt used for cron-triggered runs

let shuttingDown = false;
let inflight = 0;

// ─── Cron scheduling (optional) ───────────────────────────────────────
if (AGENT_CRON_SCHEDULE) {
  if (!cron.validate(AGENT_CRON_SCHEDULE)) {
    console.error(`[agent] Invalid AGENT_CRON_SCHEDULE: "${AGENT_CRON_SCHEDULE}". Cron disabled.`);
  } else {
    console.log(`[agent] Cron registered: ${AGENT_CRON_SCHEDULE}`);
    cron.schedule(AGENT_CRON_SCHEDULE, async () => {
      if (shuttingDown) return;
      console.log("[agent] Cron tick - invoking agent");
      inflight++;
      try {
        const result = await runAgent({
          prompt: AGENT_CRON_PROMPT ?? "Run your scheduled task.",
          triggeredBy: "cron",
        });
        console.log(`[agent] Cron run complete: ${result.status} (${result.iterations} turns, $${result.totalCost.usd.toFixed(4)})`);
      } catch (e) {
        console.error("[agent] Cron run errored:", e);
      } finally {
        inflight--;
      }
    });
  }
} else {
  console.log("[agent] No AGENT_CRON_SCHEDULE set - cron disabled, polling-only mode.");
}

// ─── Polling loop for manual triggers ─────────────────────────────────
/** Draine la file. Renvoie le nombre de triggers traités (pour la cadence). */
async function pollOnce(): Promise<number> {
  if (shuttingDown) return 0;
  const pending = await db
    .select()
    .from(agentTriggerQueue)
    .where(eq(agentTriggerQueue.status, "pending"))
    .limit(10);

  for (const trigger of pending) {
    if (shuttingDown) return 0;
    // Mark as in-progress (atomic-ish - best effort with single-worker).
    await db
      .update(agentTriggerQueue)
      .set({ status: "running", pickedUpAt: new Date() })
      .where(eq(agentTriggerQueue.id, trigger.id));

    inflight++;
    try {
      const result = await runAgent({
        prompt: trigger.prompt,
        context: (trigger.context as Record<string, unknown>) ?? undefined,
        triggeredBy: trigger.source ?? "manual",
      });
      await db
        .update(agentTriggerQueue)
        .set({
          status: "done",
          finishedAt: new Date(),
          invocationId: result.invocationId,
        })
        .where(eq(agentTriggerQueue.id, trigger.id));
      console.log(`[agent] Trigger ${trigger.id} done: ${result.status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(agentTriggerQueue)
        .set({ status: "failed", finishedAt: new Date(), errorMessage: msg })
        .where(eq(agentTriggerQueue.id, trigger.id));
      console.error(`[agent] Trigger ${trigger.id} failed:`, msg);
    } finally {
      inflight--;
    }
  }
  return pending.length;
}

async function pollLoop() {
  // Boot compte comme une activité : un trigger inséré pendant un redeploy
  // est ramassé dans les 5 s.
  let lastActivityAt = Date.now();
  while (!shuttingDown) {
    try {
      const processed = await pollOnce();
      if (processed > 0) lastActivityAt = Date.now();
    } catch (e) {
      console.error("[agent] Poll error (continuing):", e);
    }
    const inBurst = Date.now() - lastActivityAt < ACTIVITY_WINDOW_MS;
    await new Promise((r) => setTimeout(r, inBurst ? POLL_ACTIVE_MS : POLL_IDLE_MS));
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────
async function shutdown(signal: string) {
  console.log(`[agent] Received ${signal} - shutting down gracefully (${inflight} in-flight)`);
  shuttingDown = true;
  // Wait up to 60 s for in-flight invocations to finish
  const deadline = Date.now() + 60_000;
  while (inflight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`[agent] Exiting (${inflight} still in-flight after 60 s wait)`);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ─── Boot ─────────────────────────────────────────────────────────────
console.log("[agent] Boot - Render Background Worker started");
void pollLoop();
