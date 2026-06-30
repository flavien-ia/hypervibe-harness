# /add-agent-dashboard

Adds a dashboard to your admin area to monitor and drive your AI agents. You see their runs, their cost, their decisions, and you can launch some manually.

## When to use it

- You have created one or more AI agents via `/add-agent` and you want to **monitor** them from your site
- You want to **trigger an agent on demand** (for example: *"run the RSS brief now"*)
- You want to **understand the decisions** of your agents (turn by turn, which tool was used, what result)
- You want to see **how much** each agent costs in USD

## How it works

1. **Checks**: Hypervibe verifies two prerequisites:
  - **Admin authentication**: your site must have `/add-auth` configured in admin mode (the dashboard is private)
  - **At least one existing agent**: you need at least one run of `/add-agent` beforehand so that the `agent_*` tables exist in the database
   
   If either is missing, Hypervibe explains and stops.

2. **Scaffolding**: Hypervibe copies 4 pages into `apps/web/src/app/admin/agents/`:
  - **Agents list**: a recap table with name, last trigger, cumulative cost, success/error rate
  - **Agent detail**: history of all its runs (invocations), with their status, duration, cost
  - **Invocation detail**: the **full reasoning chain**: each turn of the agent, the generated text, the tools called, the tool results, the cost of the turn
  - **Manual trigger form**: a text field to enter a custom prompt, a "Run" button. The agent receives the prompt and runs immediately.

3. **tRPC router creation**: `agent-dashboard.ts` is added to your API, with the procedures to list, filter, trigger (all protected by `adminProcedure`).

4. **Router registration**: `root.ts` is patched to include the new router.

5. **Idempotence**: if you re-run `/add-agent-dashboard` later, Hypervibe detects the files already in place and leaves them intact. No risk of duplicates.

## What it creates for you

- 4 pages in your admin area:
 - `/admin/agents` (list)
 - `/admin/agents/[name]` (agent detail)
 - `/admin/agents/[name]/invocations/[id]` (reasoning chain of a run)
- A new `agent-dashboard` tRPC router for the data
- An "AI Agents" menu to add to your admin sidebar (Hypervibe offers it to you)

## Prerequisites

- Admin authentication must be configured (`/add-auth` in admin mode)
- At least one agent must have been created (`/add-agent`)

## Tips

{{callout:tip|"Run now" = very handy for testing}}
The manual trigger button is precious when you are developing an agent: you can test a custom prompt without waiting for the automatic schedule. If the agent crashes or behaves oddly, you immediately see the decision chain in the invocation detail and you diagnose it in a few seconds.
{{/callout}}

{{callout:info|Your agents show up on their own}}
You have nothing to configure in the dashboard when you create a new agent: `/add-agent` already records all the necessary data (runs, decisions, costs) as it goes. The new agent automatically appears in the list as soon as it runs for the first time.
{{/callout}}

{{callout:warning|Dashboard = admin only}}
All the dashboard routes are protected by `adminProcedure`. Only your admin login can access `/admin/agents`. Your regular users ("users" mode of `/add-auth`) cannot see this page. This is intentional, agent history can contain sensitive data.
{{/callout}}
