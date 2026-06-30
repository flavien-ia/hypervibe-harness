---
name: add-agent-dashboard
description: Add a monitoring dashboard for AI agents into the project's admin area (/admin/agents). Lists all agents with their stats (cost, success/error counts, last run), shows invocation history per agent, drills into the turn-by-turn reasoning trace of any single invocation, and lets the admin trigger an agent run manually with a custom prompt. Idempotent - safe to re-run, will skip already-installed pages. Auto-invoked by /add-agent at the end if the user opts in. Can also be invoked standalone if the user skipped the dashboard at first or wants to add it after creating multiple agents. Requires admin auth (/add-auth in admin mode) and at least one agent already created (/add-agent first).
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add Agent Dashboard - Monitoring pages for your AI agents

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You install the dashboard pages that let you **monitor, debug and trigger** the project's AI agents from the site's admin area.

The deterministic code (copying templates + patching `root.ts`) is in `scripts/setup-agent-dashboard.mjs`. This SKILL:
1. Checks the prerequisites (admin auth + at least one existing agent)
2. Runs the script
3. Shows the summary to the user

---

## Step 0 - Prerequisites

### 0.a - Admin auth

The dashboard lives under `/admin/agents` and uses `adminProcedure` on the tRPC side. So the app must have admin auth configured.

```bash
test -f apps/web/src/server/auth.ts && grep -q "isAdmin\|adminProcedure" apps/web/src/server/auth.ts && echo "ok" || echo "missing"
```

If `missing` -> stop and tell the user:

> Your agents dashboard goes through your **admin area**. You need to have set up admin authentication on your site. Run `/add-auth` (in admin mode) first, then come back here. It's quick.

### 0.b - At least one existing agent

No dashboard for zero agents. Check that the `agent_*` tables are in the DB (meaning at least one `/add-agent` has run).

```bash
grep -q "agentInvocations" apps/web/src/server/db/schema.ts && echo "ok" || echo "missing"
```

If `missing` -> stop and say:

> To have an agents dashboard, you need at least one existing agent. Run `/add-agent` first - it creates the agent + the required tables. Then come back here for the dashboard.

---

## Step 1 - Run the script

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/setup-agent-dashboard.mjs" --web-dir "<WEB_DIR>"
```

The script chains 6 sub-steps: `preflight`, `ensureTextarea` (installs the shadcn textarea component used by the trigger form), `copyPages` (copies the pages into `apps/web/src/app/admin/agents/`), `copyRouter` (copies the tRPC router into `apps/web/src/server/api/routers/agent-dashboard.ts`), `registerRouter` (patches `root.ts` to register the router), `handoff`.

**If the script finds files already in place** -> it leaves them intact and continues (idempotent). The final summary will indicate which files were new vs already installed.

### On success -> JSON on stdout:

```json
{
  "success": true,
  "filesCopied": ["src/app/admin/agents/page.tsx", ...],
  "warnings": [],
  "routes": ["/admin/agents - ...", ...],
  "nextSteps": ["pnpm dev pour voir le dashboard"]
}
```

### On failure:

- `preflight` -> a prerequisite is missing (admin auth, schema). Go back to Step 0.
- `copyPages` / `copyRouter` -> conflict with an existing file -> manual.
- `registerRouter` -> unable to locate `createTRPCRouter({...})` in `root.ts` -> ask the user to add `agentDashboard: agentDashboardRouter,` by hand and give them the exact line.

---

## Step 2 - Final summary

From the JSON:

> ## ✅ Your agents dashboard is installed
>
> 📊 **Pages added**:
> - `/admin/agents` - list of all your agents with their stats *(total cost, successful / failed runs, last run)*
> - `/admin/agents/<name>` - agent detail + **"Run now"** button + last 50 runs
> - `/admin/agents/<name>/invocations/<id>` - turn-by-turn reasoning chain, each tool called, the detailed cost
>
> ⏰ **Manual trigger delay**: ~5 seconds *(the Render worker polls the queue every 5s - not instant but plenty for a dashboard button).*
>
> 🔍 **To test**:
> 1. `pnpm dev` in your web project
> 2. Sign in to the admin area
> 3. Go to `/admin/agents`
>
> You can add more agents with `/add-agent` - they will automatically show up in the dashboard with nothing else to do.

If some files were already in place (idempotent re-run), simply say:

> The dashboard was already installed - I checked that everything is consistent, nothing to do.

---

## Notes for the agent (you, Claude)

- **i18n convention**: the `/admin/agents` dashboard and all its sub-pages **stay in French** regardless of the project's locale. No string extraction to `messages/`, no `useTranslations()`. Single-user surface (admin/owner), high string volume, near-zero translation ROI - same convention as `/admin/users` and the legal pages. If the user really wants to translate it, they can do it manually afterwards.
- **Idempotence**: the SKILL can be run multiple times without breaking anything. Re-run = no-op if everything is already in place.
- **No per-agent specific pages**: the dashboard is generic, it lists all the agents found in the DB and adapts its views. When the user adds a new agent via `/add-agent`, it shows up automatically (no need to re-install the dashboard).
- **Customization**: if the user wants business KPIs specific to their agent (e.g. "number of emails answered by my agent this month"), it's up to you to add it ad-hoc in `apps/web/src/app/admin/agents/[name]/page.tsx` at their request. The boilerplate is generic.
- **Auth required**: all the pages do `redirect("/admin/signin")` if `await isAdmin()` returns `false`. The tRPC router uses `adminProcedure`. No non-admin access possible.
