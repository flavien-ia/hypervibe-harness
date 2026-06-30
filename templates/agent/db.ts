// agent/db.ts - Drizzle client for the agent worker process.
//
// Uses @neondatabase/serverless (HTTP-based) so the worker doesn't keep
// long-lived TCP connections to Neon - friendlier with serverless quotas
// and Neon's connection pooler. Same pattern as the main Next.js app.
//
// All env vars are passed by Render at deploy (via render.yaml + dashboard).

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required (set it in the Render dashboard env vars)");
}

const sql = neon(databaseUrl);
export const db = drizzle(sql, { schema });
