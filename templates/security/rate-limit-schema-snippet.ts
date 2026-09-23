// Snippet to add to src/server/db/schema.ts (packages/db/src/schema.ts in a
// monorepo), for the shared rate limiter (templates/security/rate-limit-shared.ts).
// Put there by /security, "Shared counter", at the person's request only.
//
// Imports it needs (typical of a T3 schema): `integer`, `timestamp` and
// `varchar` from "drizzle-orm/pg-core", and the project's `createTable`.
//
// One row per address being counted. Each time a new count starts, the limiter
// forgets every address it has not counted for a day: nothing else to clean.

export const rateLimits = createTable("rate_limit", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").notNull(),
  windowStartedAt: timestamp("window_started_at", { mode: "date", withTimezone: true }).notNull(),
});
