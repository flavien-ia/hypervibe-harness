---
name: add-ai
description: "Add AI features to the user's app, powered by OpenRouter (one key, hundreds of models, no markup on inference). Discovery phase asks what the AI must DO, who will use it, at what volume, and whether personal data flows through it, then infers the right recipe: a chat assistant (streaming, in-app), a processing pipeline (classify, extract, summarise on an event), or content generation. Cost is decided BEFORE any code: the skill reads live prices from the OpenRouter catalogue, shows what the feature will cost per use and per month, and provisions a SPENDING-CAPPED key so no bug can exceed the budget. Every call is logged with its real cost, visible in the app. Use for AI that is part of the PRODUCT and answers in seconds. NOT for autonomous background agents with tools and memory (that is /add-agent), and NOT for scheduled non-AI processing (that is /add-automation)."
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js 18+. Needs an OpenRouter account; the management key is read from the vault when it is there, otherwise the user creates one inference key by hand."
---

# Add AI - Intelligence inside the product

Adds AI to the user's application: a chat assistant, a processing step, a
generator. Everything routes through **OpenRouter**, and everything routes
through **one file** in the project (`src/server/ai.ts`).

## What this skill refuses to do

Three boundaries, and they matter more than the features:

1. **No code before a validated budget.** The user sees what it will cost,
   in their currency, for their volume, from the live price catalogue. They say
   yes to a number.
2. **No key without a cap.** The key created for the project carries a spending
   limit held by OpenRouter itself. A runaway loop hits a wall on the provider's
   side, not on a counter we wrote.
3. **No free model on personal data.** Free models exist and are genuinely
   useful, but some providers train on what passes through. Free is for
   prototyping; production data goes to paid models with training refused.

## Routing away

Before anything, check this is the right skill:

- The need is an **autonomous process that decides on its own, uses tools, and
  runs in the background** → `/add-agent`.
- The need is **scheduled or event-driven processing without intelligence** →
  `/add-automation`.
- The need is **a personal recurring mission for the operator** (a weekly brief
  for themselves) → `_create-routine`.

Say which one and hand off. Do not build a second agent runtime here.

## Step 0 - Preflight (silent, before the questions)

One check, and it does NOT block: does a global OpenRouter management key
already exist?

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ai/ai-setup.mjs" cles
```

- Exit 0 → a management key is in the vault. Every project key will be created
  from here, with no manual step. Say nothing, just proceed.
- Exit 2, `raison: "coffre-verrouille"` → follow `_ensure-vault`, then retry.
- Exit 2, `raison: "cle-absente"` → no key yet. Say it NOW, in one sentence,
  rather than at the end when the budget is agreed:

  > Heads up before we start: an **OpenRouter account** will be needed (free to
  > create, you top it up as you go). I will ask for it once we know what to
  > build and what it costs.

Why here and not later: discovering at the moment of installing that an account
must be created, once the model is chosen and the budget agreed, is the kind of
surprise that makes people abandon halfway. The estimate that follows is worth
running either way, so the check never blocks.

## Step 1 - Discovery (4 questions, no more)

Use `AskUserQuestion`. Do not ask what you can infer from the project.

**Q1 - What should the AI do?** Free text, then classify into one recipe:

| Recipe | Signals | What gets built |
|---|---|---|
| `chat` | "assistant", "answer questions", "support", "converse" | Streaming route + chat panel |
| `traitement` | "classify", "extract", "sort", "analyse", "summarise" | `traiterAvecIA()` helper returning validated JSON |
| `generation` | "write", "draft", "produce a text", "description" | Same helper, higher temperature, free-text output |

If the answer covers several, build the dominant one and say the others are one
`MODELES` entry away.

**Q2 - Who uses it?**
- *Me only / my team* → no rate limit needed, generous cap.
- *My logged-in users* → per-user rate limit, cap sized on the user count.
- *Anyone, publicly* → **warn explicitly**: a public AI endpoint is a public
  wallet. Per-IP rate limit, tight cap, and say so plainly.

**Q3 - Roughly how many uses per day?** A number, even vague. It drives the
estimate. If they have no idea, propose 50 and say the cap protects them anyway.

**Q4 - Will personal data pass through?** (customer messages, CVs, health,
anything identifying.) If yes → the free tier is off the table, and the GDPR
entry is mandatory.

## Step 2 - Cost, before anything else

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ai/ai-setup.mjs" estimer \
  --gamme <gratuit|eco|qualite> --profil <chat|traitement|generation|qr> --par-jour <N>
```

Run it for **`eco` and `qualite`** (and `gratuit` when Q4 said no personal data),
then show a real comparison:

> For about 50 conversations a day, here is what it costs per month:
>
> | Tier | Model | Per use | Per month |
> |---|---|---|---|
> | Éco | google/gemini-2.5-flash-lite | 0.0017 $ | **2.57 $** |
> | Qualité | anthropic/claude-sonnet-5 | 0.039 $ | **58.50 $** |
>
> Éco is the right default for classifying, extracting, summarising. Qualité
> earns its price when the answer is read by a customer.
>
> I suggest a **cap of X $ per month**: enough for a normal month, and it stops
> an abnormal one dead.

The prices come from the OpenRouter catalogue at that moment: never quote a
price from memory, it will be wrong. The estimate already carries a 30 % margin.

**Wait for the user to pick a tier and a cap.** This is the one blocking
decision of the skill.

## Step 3 - The key

The project key is created FOR the user, from a global management key stored
once in the vault. Run:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ai/ai-setup.mjs" cle \
  --nom "<projet>" --plafond <dollars> --projet "<chemin du projet>"
```

The script creates the key, writes it into the project's `.env` and pushes it
to Vercel **itself**. It never returns the value, to anyone: the secret does
not cross the process boundary, so nothing downstream can print it, not even
by crashing. Report `hash`, `plafondUsd` and the `journal` lines, nothing else.

- Exit 0, `ok: true` → installed. Move on.
- Exit 0, `ok: false` → the key exists but could not be written. Tell the user
  to **revoke it** at openrouter.ai/settings/keys and rerun: never go fetch the
  value by hand to paste it somewhere.
- Exit 2, `raison: "coffre-verrouille"` → follow `_ensure-vault`, retry.
- Exit 2, `raison: "cle-absente"` → the one-time setup below.

### One-time setup of the management key

Walk the user through it, step by step. It happens once, and every future
project then gets its capped key with no manual step at all.

> **1. Create the OpenRouter account** (free): https://openrouter.ai
>
> Sign up **with GitHub**: you already use it for the rest of your stack, so
> it is one less password, and the account is tied to an identity you control.
>
> **2. Add a few credits.** Ten dollars is plenty to start, and it also raises
> the free-model allowance from 50 to 1000 requests a day. Without credits, the
> very first call fails, even on a free model.
>
> **3. Create the management key**:
> https://openrouter.ai/settings/management-keys
>
> Click **"+ New Key"** and name it **`claude code`**. This key never runs a
> model: it only creates, lists and revokes the per-project keys, each with its
> own spending cap. That is what lets me set up any future project without
> asking you for anything.

Then open the masked window so the value never passes through the conversation:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/vault/launch.mjs" add \
  --name OPENROUTER --service OpenRouter --fields "management_key:secret"
```

Then rerun the `cle` command above.

**If the user refuses the management key**, fall back: they create an ordinary
key at https://openrouter.ai/settings/keys with **"+ New Key"**, set its credit
limit **in that dialog** (the limit is the entire guardrail, a key without one
defeats the purpose of this skill), and hand it over through `_collect-secret`,
which writes it to `.env` + Vercel without showing it either.

## Step 4 - Install

1. **The shared brick.** Copy `templates/ai/ai.ts` to `src/server/ai.ts` and
   fill in:
   - `__MODELES__` → one entry per usage, with the chosen model and a
     `maxTokens` sized on the recipe (chat 1200, traitement 600, generation
     2000). Example:
     ```ts
     chat: { modele: "anthropic/claude-sonnet-5", maxTokens: 1200 },
     ```
   - `__APP_NAME__` → the project name.
2. **The cost log.** Append `templates/ai/schema-snippet.ts` to
   `src/server/db/schema.ts`, then `pnpm db:push`. If the project has no
   database, say the cost log needs one and offer `/add-db`; the AI works
   without it, blind.
3. **The recipe.**
   - `chat` → `templates/ai/chat-route.ts` to `src/app/api/chat/route.ts`
     (fill `__CONSIGNE_SYSTEME__` from what the user described, `__GARDE_ACCES__`
     from Q2, `__USER_ID__` with the session user or `null`), and
     `templates/ai/chat-panel.tsx` to `src/components/chat-panel.tsx`. Wire it
     into a real page, never leave it orphaned.
   - `traitement` / `generation` → `templates/ai/traitement.ts` to
     `src/server/ai-traitement.ts`, `__SCHEMA_CHAMPS__` filled with the fields
     the user actually needs, and call it from a real place in the project.
4. **Rate limit** if Q2 said users or public: reuse the project's existing
   limiter if there is one; otherwise a simple per-user-and-hour count on
   `ai_usage`, which is already indexed for it.

## Step 5 - GDPR and documentation

- `node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add openrouter`
- Invoke `_update-claude-md` with a **Conventions** entry:
  > AI: every model call goes through `src/server/ai.ts` (OpenRouter). Adding an
  > intelligent feature means adding an entry to `MODELES`, never opening
  > another route to the provider: that file is what guarantees the token cap,
  > the cost log and the no-training routing. The key is capped on OpenRouter's
  > side; raise the cap at openrouter.ai/settings/keys.
- Record the resource with `_track-resource`.

## Step 6 - Wrap up

> ✅ **AI installed.**
>
> - What it does: <recipe, in one sentence>
> - Model: <id> (tier <Éco/Qualité>)
> - Estimated cost: **<X> $ per month** for <N> uses a day
> - Hard cap: **<Y> $**, held by OpenRouter. Past it, calls stop and the app
>   says so rather than failing silently.
> - Every call is logged with its real cost in the `ai_usage` table.
>
> To change model, edit `MODELES` in `src/server/ai.ts`. To change the cap, go
> to openrouter.ai/settings/keys.

Then say the one thing they will hit first: **the first call fails if the
OpenRouter account has no credits**, even for free models beyond 50 requests a
day. Adding 10 $ of credits also raises the free-model limit to 1000 a day.

### What the cap actually does (verified against OpenRouter's docs)

- An exhausted **per-key** credit limit returns **HTTP 402**, the same status as
  an empty account balance. That is what `src/server/ai.ts` catches to say
  « budget épuisé » instead of a cryptic failure.
- `GET https://openrouter.ai/api/v1/key`, called with the project key itself,
  returns `limit` and `limit_remaining`. Use it to show how much of the budget
  is left rather than making the user guess, and to warn before the wall.
- Third-party reports (not in the official docs, so do not present it as
  certain) say the remaining budget is checked against `max_tokens`, the
  maximum POSSIBLE output, not the tokens actually produced. If they are right,
  a generous `max_tokens` can trigger a 402 near the cap on a request that would
  have been cheap. One more reason to size `maxTokens` on the recipe rather than
  leaving it wide.
