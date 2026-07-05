---
name: _create-routine
description: Internal helper that turns an operator-side agentic task ("brief me every morning", "analyze my week every Friday", "watch X and alert me") into a Claude routine - a scheduled AI run on the user's own Claude account (cloud routine) or on their machine (local scheduled task). Detects which mechanism the current session offers, drafts a self-contained mission prompt, explains the account coupling and cost in plain words, creates the routine and verifies it. Invoked by /add-automation and /add-agent for the ops-agentic quadrant. NEVER for app runtime jobs (those go to /add-cron or a worker). Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash, Read, Skill
compatibility: "Claude Code (CLI or desktop app). Cloud routines need Claude Code >= 2.1.81 or the desktop app; local scheduled tasks need the desktop app."
---

# Create Routine - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal tool names; describe actions in human terms.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive from the calling skill (or infer from the conversation):
- `GOAL` - what the routine must accomplish, in the user's words
- `CADENCE` - when it should run (plain language: "every morning", "Friday evening", "once a week")
- optionally a preference for where it runs (cloud / this computer)

## What a routine is (say this to the user, adapted to their language)

> A routine is a mission that **your own Claude** runs for you on a schedule, without you having to ask. It can read, reason, use your connected tools, and write you a result. It runs on **your Claude account**: it is your personal assistant working for you, NOT a part of your app's infrastructure.

## Step 0 - Guard: is this really an operator-side task?

A routine is the right tool ONLY when the OUTPUT is for the operator (the user or their team): a brief, a report, a triage, an alert, a proposal. If the task's output feeds the APP or its end users (cleaning the database, sending emails to customers, syncing data the app displays), STOP and hand back to `/add-automation`: that is an app runtime job and it must run on the app's infrastructure (worker or cron), never on someone's personal Claude account.

Three-point smell test (any hit = app job, bounce back):
1. Would the app break or the end users notice if this stopped running?
2. Does it write to the app's database or send messages to the app's users?
3. Should it keep working even if the operator cancels their Claude subscription?

## Step 1 - Detect the available mechanism

Probe what THIS session can create, in this order:

1. **Cloud routine** - available when the session exposes the cloud scheduling capability (the `/schedule` command managing "scheduled cloud agents (routines)" on claude.ai). Runs on Anthropic's servers: works even when the computer is off. Minimum cadence: 1 hour. The run environment is the cloud (connected repos + connectors), not this machine's filesystem.
2. **Local scheduled task** - available when the session has scheduled-task tools (Claude desktop app; tools like `create_scheduled_task` / `list_scheduled_tasks`). Runs on THIS computer while the Claude app is open (a missed run fires at next launch). Full access to local files, local scripts and the machine's tools.
3. **Neither** - the session cannot create routines (e.g. an old CLI version). Fall back to guided creation: give the user their ready-to-paste mission prompt and point them to https://claude.ai/code/routines (bouton "New routine"), or suggest updating Claude Code.

When BOTH are available, choose by the nature of the task and say why in one sentence:
- Needs local files, local scripts, the machine's browser -> **local**
- Pure cloud work (read repos, web, connectors, send a report) and should survive the computer being off -> **cloud**
- User expressed a preference -> respect it.

## Step 2 - The two honest warnings (mandatory, in plain words)

Before creating anything, tell the user (adapt, do not soften):

> 1. **It runs on your Claude account.** Each run consumes a bit of your Claude subscription usage, like a conversation you would have yourself. If your subscription stops, the routine stops with it. That is exactly why we only use routines for things that serve YOU, never for things your app needs to function.
> 2. *(cloud only)* **It runs in the cloud**, so it works even when your computer is off, but it cannot touch files that only exist on this machine.
> *(local only)* **It runs on this computer** while the Claude app is open. If the app is closed at the scheduled time, the run happens at the next launch.

## Step 3 - Draft the mission prompt

Routine runs start from a BLANK context: the prompt must be fully self-contained. Draft it with:

1. **Objective** - one clear sentence.
2. **Steps** - the concrete sequence (what to read, what to analyze, what to produce).
3. **Resources** - exact file paths, URLs, repos, connectors or tools to use.
4. **Output** - what to deliver and where (a chat summary, an email, a file, a draft).
5. **Constraints** - tone, length, budget of actions, what NOT to do.

Never reference "this conversation" or "as discussed" inside the prompt. Show the drafted prompt to the user and let them adjust it before creating - it is THE contract of the routine.

## Step 4 - Translate the cadence

- Express the schedule in the user's LOCAL time (both mechanisms interpret cron in local time).
- Avoid minute :00 and :30 when the user's wording is approximate ("around 9am" -> 8:57 or 9:04): it spreads the load and runs earlier in practice.
- Cloud minimum is 1 hour between runs. If the user asks for something more frequent, explain the limit and question the need: an operator-side brief rarely needs sub-hourly runs; if it truly does, it is probably an app job in disguise (back to Step 0).
- One-shot ("remind me next Tuesday") -> use the one-time mode of the mechanism (fire-at), not a recurring cron.

## Step 5 - Create, verify, hand over

1. Create the routine through the detected mechanism (for cloud: follow the `/schedule` flow; for local: the scheduled-task creation tool). Kebab-case id derived from the goal (e.g. `morning-competitor-brief`).
2. **Verify**: list the scheduled tasks/routines and confirm the new one is there with the right schedule. Report the next run time to the user.
3. If the routine will use connectors or browser control (local), recommend one manual "Run now" first so the permission prompts are approved once and future runs never stall on them.
4. Tell the user how to manage it later, in their words: pause, edit the mission, change the schedule, delete - via the Routines/Scheduled section of their Claude app, or by asking Claude ("mets ma routine en pause", "change l'heure de mon brief").

## Return to the calling skill

Report back: `{ created: true, mechanism: "cloud" | "local" | "guided", id, schedule, nextRun }` so the caller can include it in its final summary. If the user declined after the warnings, report `{ created: false, reason }` - the calling skill then offers the classic alternatives (a cron with a simple script, or nothing).
