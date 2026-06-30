// agent-dashboard/router.ts - tRPC router for the agent monitoring dashboard.
//
// Drop this into the project's `src/server/api/routers/` directory and
// register it in `root.ts` as `agentDashboard: agentDashboardRouter`.
//
// All procedures are admin-only (gated by a local adminProcedure that calls
// isAdmin() from the project's admin auth). If the project doesn't yet have
// admin auth, /add-agent-dashboard refuses to install and prompts the user to
// run /add-auth (admin mode) first.
//
// Provides:
//   - listAgents              : list distinct agent_name values + their stats
//   - listInvocations         : paginated invocations for one agent
//   - getInvocation           : single invocation + all its turns
//   - costStats               : daily/monthly cost breakdown for one agent
//   - triggerManual           : insert a row in agent_trigger_queue
//   - killSwitch              : pause/resume an agent (sets a flag)
//
// The Render worker reads agent_trigger_queue every 5 s and runs anything
// pending. So "trigger manual" lag is ~5 s, not instant - fine for a
// dashboard button.

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { isAdmin } from "~/server/auth";
import {
  agentInvocations,
  agentTurns,
  agentTriggerQueue,
} from "~/server/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Admin-only procedure. The project ships admin auth via /add-auth (admin mode),
// which exports isAdmin() from ~/server/auth; we re-derive admin status here so
// every dashboard procedure (including the dangerous triggerManual) is gated.
const adminProcedure = publicProcedure.use(async ({ next }) => {
  if (!(await isAdmin())) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Admin access required." });
  }
  return next();
});

export const agentDashboardRouter = createTRPCRouter({
  /** List of distinct agents that have at least one invocation, with their quick stats. */
  listAgents: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        agentName: agentInvocations.agentName,
        totalInvocations: sql<number>`COUNT(*)::int`,
        totalCostUsd: sql<string>`COALESCE(SUM(${agentInvocations.totalCostUsd}::numeric), 0)`,
        lastRun: sql<Date | null>`MAX(${agentInvocations.startedAt})`,
        successCount: sql<number>`COUNT(*) FILTER (WHERE ${agentInvocations.status} = 'success')::int`,
        errorCount: sql<number>`COUNT(*) FILTER (WHERE ${agentInvocations.status} = 'error')::int`,
        budgetKilledCount: sql<number>`COUNT(*) FILTER (WHERE ${agentInvocations.status} = 'budget_killed')::int`,
      })
      .from(agentInvocations)
      .groupBy(agentInvocations.agentName)
      .orderBy(sql`MAX(${agentInvocations.startedAt}) DESC NULLS LAST`);
    return rows.map((r) => ({
      ...r,
      totalCostUsd: Number(r.totalCostUsd),
    }));
  }),

  /** Paginated invocations for a single agent. */
  listInvocations: adminProcedure
    .input(
      z.object({
        agentName: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(), // invocation id to start after
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: agentInvocations.id,
          status: agentInvocations.status,
          triggeredBy: agentInvocations.triggeredBy,
          promptPreview: agentInvocations.promptPreview,
          iterations: agentInvocations.iterations,
          totalCostUsd: agentInvocations.totalCostUsd,
          startedAt: agentInvocations.startedAt,
          finishedAt: agentInvocations.finishedAt,
          errorMessage: agentInvocations.errorMessage,
        })
        .from(agentInvocations)
        .where(eq(agentInvocations.agentName, input.agentName))
        .orderBy(desc(agentInvocations.startedAt))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return { items, nextCursor: hasMore ? items[items.length - 1]?.id : null };
    }),

  /** A single invocation + all its turns (full reasoning trace). */
  getInvocation: adminProcedure
    .input(z.object({ invocationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [invocation] = await ctx.db
        .select()
        .from(agentInvocations)
        .where(eq(agentInvocations.id, input.invocationId));
      if (!invocation) throw new TRPCError({ code: "NOT_FOUND" });
      const turns = await ctx.db
        .select()
        .from(agentTurns)
        .where(eq(agentTurns.invocationId, input.invocationId))
        .orderBy(agentTurns.turnNumber);
      return { invocation, turns };
    }),

  /** Daily/monthly cost stats for one agent over the last 30 days. */
  costStats: adminProcedure
    .input(z.object({ agentName: z.string() }))
    .query(async ({ ctx, input }) => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dailyRows = await ctx.db
        .select({
          day: sql<string>`date_trunc('day', ${agentInvocations.startedAt})`,
          invocations: sql<number>`COUNT(*)::int`,
          costUsd: sql<string>`COALESCE(SUM(${agentInvocations.totalCostUsd}::numeric), 0)`,
        })
        .from(agentInvocations)
        .where(
          and(
            eq(agentInvocations.agentName, input.agentName),
            gte(agentInvocations.startedAt, since),
          ),
        )
        .groupBy(sql`date_trunc('day', ${agentInvocations.startedAt})`)
        .orderBy(sql`date_trunc('day', ${agentInvocations.startedAt})`);

      const totalCost = dailyRows.reduce((s, r) => s + Number(r.costUsd), 0);
      return {
        daily: dailyRows.map((r) => ({ day: r.day, invocations: r.invocations, costUsd: Number(r.costUsd) })),
        totalCostLast30d: totalCost,
        totalInvocationsLast30d: dailyRows.reduce((s, r) => s + r.invocations, 0),
      };
    }),

  /** Insert a manual trigger. The Render worker picks it up within 5 s. */
  triggerManual: adminProcedure
    .input(
      z.object({
        agentName: z.string(),
        prompt: z.string().min(1).max(10000),
        context: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(agentTriggerQueue)
        .values({
          agentName: input.agentName,
          prompt: input.prompt,
          context: input.context ?? null,
          source: "dashboard",
        })
        .returning({ id: agentTriggerQueue.id });
      return { triggerId: row!.id };
    }),

  /** Status of a previously-submitted manual trigger. */
  triggerStatus: adminProcedure
    .input(z.object({ triggerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(agentTriggerQueue)
        .where(eq(agentTriggerQueue.id, input.triggerId));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),
});
