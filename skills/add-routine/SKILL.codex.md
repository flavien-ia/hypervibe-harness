---
name: add-routine
description: "Create a recurring AI mission for YOURSELF, run on a schedule by the Codex app on this computer: a morning brief, a Friday analysis, a watch that alerts you. Zero code, zero deployment, nothing added to the app."
---

# Add Routine - A recurring mission for YOU

## Communication
- Detect the user's language from the conversation (the user's own messages, anywhere in the session - not just this invocation: a bare slash command like `/bootstrap` carries no language signal by itself). If nothing in the conversation gives a signal, fall back to the OS locale (`node -e "console.log(Intl.DateTimeFormat().resolvedOptions().locale)"`) before defaulting to English. ALWAYS reply in that language for every user-facing message: questions, progress, confirmations, summaries, errors - including any example text quoted in this skill, which is illustrative and must be translated, never sent verbatim.
- Plain, non-technical language. A routine is "a mission Codex runs for you on a schedule" - never "a scheduled automation job".
- Show progress as a short natural-language checklist.

## What this skill is

A thin, user-invocable front for the routine engine (**`_create-routine`**), so that the two shapes a user can name for themselves have a clean direct entry: `/add-cron` (scheduled app task) and `/add-routine` (personal recurring AI mission). The other two, an event-triggered in-app pipeline and an autonomous product agent, are chosen by `/add-automation`, which remains the orchestrator.

## Step 1 - Gather the mission (light discovery)

If the user's request already contains the mission and the cadence ("brief me on my competitors every morning at 8"), do NOT re-ask - go straight to Step 2.

Otherwise, one question:

> **What should Codex do for you, and when?** For example: "every morning, read X and give me a 5-line brief", "every Friday, analyze Y and propose improvements".

Extract `GOAL` (the mission, in the user's words) and `CADENCE` (plain language).

## Step 2 - The guard (do not skip)

Apply the operator-side test from the engine before anything else: if the output feeds the APP or its end users (cleaning the database, emailing customers, syncing displayed data), STOP and reroute honestly:

> What you describe is something your **app** needs, so it must run on the app's infrastructure, not in the Codex app on your computer (the day the computer is off or the app closed, your app would silently break). The right command is <`/add-cron` | `/add-automation`> - want me to run it?

## Step 3 - Delegate to the engine

Invoke **`_create-routine`** with `GOAL` and `CADENCE`. The engine handles everything: checking that this session can schedule (scheduled tasks live in the Codex desktop app), the honest warnings, where each run happens, the self-contained mission prompt validated by the user, creation, verification, and the management handover.

## Step 4 - Summary

Relay the engine's result:

> ✅ Your routine **<name>** is active: <mission in 1 sentence>, <schedule in plain words>, next run <date/time>. Its results appear in **Scheduled** in the Codex app.
> To manage it, just tell me: *"pause my routine"*, *"change the schedule"*, *"show me its last run"*, *"delete it"*.

If the engine could only prepare the routine (no scheduling tool in this session), relay the ready-to-paste prompt and the two gestures in the Codex app: open **Scheduled**, create the task.

If the routine touches a Hypervibe project (e.g. "analyze MY PROJECT's errors weekly"), also invoke `_update-claude-md` on that project with the `## Routines (opérateur)` section, same format as `/add-automation` Branch D.
