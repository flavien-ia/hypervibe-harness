// agent/entry.ts - Long-running entry point for the Render Background Worker.
//
// Two trigger sources, both feeding into runAgent():
//   1. Internal cron (via node-cron)            - scheduled runs
//   2. DB queue polling (every 5 s)             - manual triggers from dashboard
//                                                  (or any backend code that
//                                                   inserts into agent_trigger_queue)
//
// Why polling instead of an HTTP endpoint?
//   - Render Background Worker doesn't expose ports (Web Service does, but
//     sleeps after 15 min on free tier - bad for an agent that must respond
//     within a few seconds to manual triggers).
//   - Polling a DB queue every 5 s is simple, reliable, no public surface to
//     attack. The "trigger now" button in the dashboard just inserts a row
//     and gets a row id back.
//
// Lifecycle:
//   - On boot: register the cron schedule (if AGENT_CRON_SCHEDULE is set)
//   - Loop forever: poll queue, run any pending triggers, sleep 5 s
//   - On SIGTERM (Render restart): finish in-flight invocations, exit clean

import cron from "node-cron";
import { db } from "./db.js";
import { agentTriggerQueue } from "./schema.js";
import { eq } from "drizzle-orm";
import { runAgent } from "./loop.js";

const POLL_INTERVAL_MS = 5_000;
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
async function pollOnce() {
  if (shuttingDown) return;
  const pending = await db
    .select()
    .from(agentTriggerQueue)
    .where(eq(agentTriggerQueue.status, "pending"))
    .limit(10);

  for (const trigger of pending) {
    if (shuttingDown) return;
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
}

async function pollLoop() {
  while (!shuttingDown) {
    try {
      await pollOnce();
    } catch (e) {
      console.error("[agent] Poll error (continuing):", e);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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
