// agent/tools/index.ts - Tool registry consumed by loop.ts.
//
// Each tool is a `{ definition, handler }` pair:
//   - definition : the JSON schema sent to Claude (name, description, input_schema)
//   - handler    : an async JS function that runs the tool with the args Claude provides
//
// Add or remove tools here. The loop reads `Object.values(tools)` to build
// the `tools` array sent to the Anthropic API, so anything added here is
// automatically available to the agent.
//
// To remove a tool the agent shouldn't access, just delete its line. To add
// one, mirror the pattern of the existing ones.

import { tool as httpFetchTool } from "./http-fetch.js";
import { tool as sendEmailTool } from "./send-email.js";
import { tool as dbQueryTool } from "./db-query.js";

export const tools = {
  http_fetch: httpFetchTool,
  send_email: sendEmailTool,
  db_query: dbQueryTool,
} as const;

export type ToolHandler = (input: Record<string, unknown>) => Promise<string | unknown>;

export type ToolName = keyof typeof tools;
