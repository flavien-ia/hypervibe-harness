---
name: add-routine
description: "Create a personal recurring AI mission (a Claude routine): 'brief me every morning', 'analyze my week every Friday', 'watch X and alert me'. The mission runs on the USER'S OWN Claude account (cloud routine, or local scheduled task), not on any app infrastructure - zero code, zero deployment. Direct entry point to the routine engine; /add-automation routes here automatically when it detects an operator-side AI mission. Guards against misuse: anything the APP depends on is rerouted to /add-cron or /add-automation."
compatibility: "Claude Code (CLI or desktop app). Cloud routines need Claude Code >= 2.1.81 or the desktop app; local scheduled tasks need the desktop app."
---

# Add Routine - A recurring mission for YOUR Claude

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Plain, non-technical language. A routine is "a mission your own Claude runs for you on a schedule" - never "a scheduled cloud agent job".
- Show progress as a short natural-language checklist.

## What this skill is

A thin, user-invocable front for the routine engine (**`_create-routine`**), so that the four automation shapes each have a clean direct entry: `/add-cron` (scheduled app task), `/add-workflow` (event-triggered in-app pipeline), `/add-agent` (autonomous product agent), `/add-routine` (personal recurring AI mission). `/add-automation` remains the orchestrator that picks among them for you.

## Step 1 - Gather the mission (light discovery)

If the user's request already contains the mission and the cadence ("brief me on my competitors every morning at 8"), do NOT re-ask - go straight to Step 2.

Otherwise, one question:

> **What should your Claude do for you, and when?** For example: "every morning, read X and send me a 5-line brief", "every Friday, analyze Y and propose improvements".

Extract `GOAL` (the mission, in the user's words) and `CADENCE` (plain language).

## Step 2 - The guard (do not skip)

Apply the operator-side test from the engine before anything else: if the output feeds the APP or its end users (cleaning the database, emailing customers, syncing displayed data), STOP and reroute honestly:

> What you describe is something your **app** needs, so it must run on the app's infrastructure, not on your personal Claude account (if your subscription stopped, your app would silently break). The right command is <`/add-cron` | `/add-workflow` | `/add-automation`> - want me to run it?

## Step 3 - Delegate to the engine

Invoke **`_create-routine`** with `GOAL` and `CADENCE` (and any expressed preference for cloud vs this computer). The engine handles everything: mechanism detection, the two honest warnings (runs on the user's account and subscription; cloud vs local trade-offs), the self-contained mission prompt validated by the user, creation, verification, and the management handover.

## Step 4 - Summary

Relay the engine's result:

> ✅ Your routine **<id>** is active: <mission in 1 sentence>, <schedule in plain words>, next run <date/time>.
> To manage it, just tell me: *"pause my routine"*, *"change the schedule"*, *"show me its last run"*, *"delete it"*.

If the routine touches a Hypervibe project (e.g. "analyze MY PROJECT's errors weekly"), also invoke `_update-claude-md` on that project with the `## Routines (opérateur)` section, same format as `/add-automation` Branch D.
