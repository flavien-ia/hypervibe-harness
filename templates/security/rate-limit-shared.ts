// Shared rate limiter: the count lives in this project's own database, so every
// running copy of the server sees the same number, and a restart resets nothing.
//
// It replaces the in-memory limiter of src/lib/rate-limit.ts, and only when the
// person asked for it after a real attack (/security, "Shared counter"). Same
// limits, same result, but asynchronous: every call is awaited
// (`await checkRateLimit(ip)`), and a forgotten await is a type error, so the
// compiler finds any call left behind.
//
// Cost: one small query per check (a login, a form sent), on a database that
// the request usually wakes anyway. No new service, key or account.

import { lt, sql } from "drizzle-orm";

import { db } from "~/server/db";
import { rateLimits } from "~/server/db/schema";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000; // an address is forgotten after a day

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const now = new Date();
  const windowOpen = new Date(now.getTime() - WINDOW_MS).toISOString();

  // One statement, atomic even when several copies of the server answer at the
  // same moment: a new address starts at 1, an expired window starts again at 1,
  // otherwise the count goes up by one.
  const [row] = await db
    .insert(rateLimits)
    .values({ key: ip, count: 1, windowStartedAt: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStartedAt} < ${windowOpen}::timestamptz THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${rateLimits.windowStartedAt} < ${windowOpen}::timestamptz THEN ${now.toISOString()}::timestamptz ELSE ${rateLimits.windowStartedAt} END`,
      },
    })
    .returning({ count: rateLimits.count, windowStartedAt: rateLimits.windowStartedAt });

  // A new count has just started: the moment to forget every address not
  // counted for a day. An IP address is personal data, kept no longer than it
  // serves.
  if (row?.count === 1) {
    await db.delete(rateLimits).where(lt(rateLimits.windowStartedAt, new Date(now.getTime() - FORGET_AFTER_MS)));
  }

  if (!row || row.count <= MAX_ATTEMPTS) return { allowed: true };
  const retryAfterMs = Math.max(0, new Date(row.windowStartedAt).getTime() + WINDOW_MS - now.getTime());
  return { allowed: false, retryAfterMs };
}
