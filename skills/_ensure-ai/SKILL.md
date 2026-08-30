---
name: _ensure-ai
description: "Internal - guarantees the project can call a model through its single AI brick (src/server/ai.ts, OpenRouter): a validated budget, a provider-side spending cap, and the no-training routing. Not meant to be invoked directly by users."
user-invocable: false
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js 18+. Needs an OpenRouter account; the management key is read from the vault when it is there, otherwise the user creates one inference key by hand."
---

# Ensure AI - The single brick, and its three guardrails

You guarantee that the project can call a model **through one file and one key**,
and that the three guardrails hold. Every skill that needs intelligence calls
you first, so that no skill ever opens its own route to a provider.

You are **silent when there is nothing to do**. A project that already has its
brick gets no dialogue: you add the usage entry and hand back.

## Communication
- Detect the user's language from the conversation (the user's own messages, anywhere in the session - not just this invocation: a bare slash command like `/bootstrap` carries no language signal by itself). If nothing in the conversation gives a signal, fall back to the OS locale (`node -e "console.log(Intl.DateTimeFormat().resolvedOptions().locale)"`) before defaulting to English. ALWAYS reply in that language for every user-facing message: questions, progress, confirmations, summaries, errors - including any example text quoted in this skill, which is illustrative and must be translated, never sent verbatim.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

## The three guardrails, and where each one lives

They are not of the same nature, which is why they cannot all live in a script:

| Guardrail | Nature | Where it is applied |
|---|---|---|
| A budget the user validated | A conversation | Step 3 of this skill: an estimate from the live catalogue, and the user says yes to a number |
| A key the provider itself caps | Infrastructure | Step 4: the key is minted with a spending limit held by OpenRouter |
| No-training routing, cost log, token ceiling | Shipped code | Step 5: `templates/ai/ai.ts` copied into the project |

The guarantee is **structural**: every skill goes through here, so no call can
escape them. It is never enforced by policing the user's code.

## The contract with the calling skill

**Input** the caller provides (it never asks the user for these again):

| Field | Values | Meaning |
|---|---|---|
| `USAGE` | identifier, e.g. `chat`, `workflow_tri_tickets` | The `MODELES` entry to guarantee. One usage = one entry = one model + one token ceiling |
| `PROFIL` | `chat` / `traitement` / `generation` / `qr` | Shapes the estimate and the token ceiling |
| `PAR_JOUR` | a number | Expected calls per day, for the estimate |
| `DONNEES_PERSONNELLES` | `oui` / `non` | If `oui`, the free tier is off the table and the GDPR entry is mandatory |
| `CIBLE` | `app` (default) | Where the brick goes. `worker` is handled by `_create-agent`, which has its own runtime and its own dedicated key |

**Output** you hand back:

| Field | Values |
|---|---|
| `MODE` | `brique` (the project calls through `src/server/ai.ts`) or `direct` (the project deliberately calls a provider itself) |
| `FOURNISSEUR` | `openrouter`, or the provider chosen in the opt-out |
| `MODELE` | the model id bound to `USAGE` |
| `PLAFOND_USD` | the cap on the key, when there is one |

When `MODE` is `direct`, the caller writes its model call **following the
project's existing pattern**, and never proposes OpenRouter again.

---

## Step 1 - Situate the project (silent)

1. Invoke **`_detect-project-root`** -> `PROJECT_NAME`, `WEB_DIR`, `IS_MONOREPO`, `IS_NEXTJS`.
2. Read the resource manifest, which is where a deliberate choice was recorded:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/manifest/manifest.mjs" list \
  --project-dir "<project-root>" --kind ai-key
```

Three outcomes, and only the third opens a dialogue:

- An entry with `mode: "direct"` -> **the user has already chosen a provider in
  the past.** Hand back `MODE=direct` with its `FOURNISSEUR`. Say nothing: the
  decision was made, re-litigating it at every skill would be nagging.
- `<WEB_DIR>/src/server/ai.ts` exists -> go to **Step 6** (add the usage).
- Neither -> check for a legacy setup before continuing to Step 2.

### The legacy case (a project from before the brick)

Some projects were wired with a provider key in their `.env` and calls written
inline, because that is what an older version of this plugin did:

```bash
grep -lE "^(ANTHROPIC|OPENAI)_API_KEY=" "<project-root>/.env" 2>/dev/null
```

If a key is there and there is no `src/server/ai.ts`, do not silently install a
second route to a model beside the first. Offer, once:

> This project already calls <provider> directly, from an earlier setup. I can
> **bring those calls into a single file** with a spending cap, a cost log per
> feature, and one place to change model later. Nothing changes for your users.
> Or I keep your current setup and add to it. Which do you prefer?

- They accept -> continue at Step 2, and once the brick is installed, move the
  existing calls onto `appelerIA` (same behaviour, one route) rather than
  leaving two.
- They decline -> record the choice as in **Step 7** and hand back `MODE=direct`.
  Never ask again.

## Step 2 - The account, said early (does NOT block)

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ai/ai-setup.mjs" cles
```

- Exit 0 -> a management key is in the vault. Every project key is minted from
  it with no manual step. Say nothing, proceed.
- Exit 2, `raison: "coffre-verrouille"` -> follow **`_ensure-vault`**, then retry.
- Exit 2, `raison: "cle-absente"` -> no key yet. Say it NOW, in one sentence,
  rather than at the end once the budget is agreed:

  > Heads up before we start: an **OpenRouter account** will be needed (free to
  > create, you top it up as you go). I will ask for it once we know what to
  > build and what it costs.

Why here and not later: discovering at the moment of installing that an account
must be created, once the model is chosen and the budget agreed, is the kind of
surprise that makes people abandon halfway. The estimate that follows is worth
running either way, so this check never blocks.

## Step 3 - The budget, before a single line of code

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ai/ai-setup.mjs" estimer \
  --gamme <gratuit|eco|qualite> --profil <PROFIL> --par-jour <PAR_JOUR>
```

Run it for **`eco` and `qualite`** (and `gratuit` only when
`DONNEES_PERSONNELLES=non`), then show a real comparison:

> For about 50 uses a day, here is what it costs per month:
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

Prices come from the OpenRouter catalogue at that moment: never quote one from
memory, it will be wrong. The estimate already carries a 30 % margin.

**Wait for the user to pick a tier and a cap.** This is the one blocking
decision, and it is the first guardrail.

If the user answers that they would rather call a provider directly (they
already have an OpenAI or Anthropic account, an internal policy imposes one,
they simply prefer it), go to **Step 7**. Never insist, and never block.

## Step 4 - The capped key

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ai/ai-setup.mjs" cle \
  --nom "<PROJECT_NAME>" --plafond <dollars> --projet "<project-root>"
```

The script creates the key, writes it into the project's `.env` and pushes it
to Vercel **itself**. It never returns the value, to anyone: the secret does not
cross the process boundary, so nothing downstream can print it, not even by
crashing. Report `hash`, `plafondUsd` and the `journal` lines, nothing else.

- Exit 0, `ok: true` -> installed, move on.
- Exit 0, `ok: false` -> the key exists but could not be written. Tell the user
  to **revoke it** at openrouter.ai/settings/keys and rerun: never go fetch the
  value by hand to paste it somewhere.
- Exit 2, `raison: "coffre-verrouille"` -> follow **`_ensure-vault`**, retry.
- Exit 2, `raison: "cle-absente"` -> the one-time setup below.

### One-time setup of the management key

Walk the user through it, step by step. It happens once, and every future
project then gets its capped key with no manual step at all.

> **1. Create the OpenRouter account** (free): https://openrouter.ai
>
> Sign up **with GitHub**: you already use it for the rest of your stack, so it
> is one less password, and the account is tied to an identity you control.
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
defeats the purpose of this skill), and hand it over through **`_collect-secret`**
as `OPENROUTER_API_KEY`, which writes it to `.env` + Vercel without showing it
either.

## Step 5 - Install the brick

1. Copy `templates/ai/ai.ts` to `<WEB_DIR>/src/server/ai.ts` and fill in:
   - `__APP_NAME__` -> the project name.
   - `__MODELES__` -> the entry for `USAGE` (Step 6 does this, and every later
     usage lands in the same place).
   - `__FOURNISSEURS_AUTORISES__` -> `[]` by default. Only fill it when the
     user states a residency or provider requirement (see the comment in the
     template): the list restricts routing to named providers, at the cost of
     availability.
2. **The cost log.** Append `templates/ai/schema-snippet.ts` to
   `<WEB_DIR>/src/server/db/schema.ts`, then `pnpm db:push`. If the project has
   no database, say the cost log needs one and offer `/add-db`; the AI works
   without it, blind.
3. Add `OPENROUTER_API_KEY` to `src/env.js` (server section), following the
   file's existing pattern.
4. GDPR and documentation:
   - `node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add openrouter`
   - Invoke **`_update-claude-md`** with a **Conventions** entry:
     > AI: every model call goes through `src/server/ai.ts` (OpenRouter). Adding
     > an intelligent feature means adding an entry to `MODELES`, never opening
     > another route to the provider: that file is what guarantees the token
     > cap, the cost log and the no-training routing. The key is capped on
     > OpenRouter's side; raise the cap at openrouter.ai/settings/keys.
   - Record the key with **`_track-resource`**:
     ```bash
     node "${CLAUDE_SKILL_DIR}/../../scripts/manifest/manifest.mjs" add \
       --project-dir "<project-root>" --kind ai-key --name "<PROJECT_NAME>" \
       --field provider=openrouter --field hash=<hash> \
       --added-by _ensure-ai
     ```
     The hash identifies the key for rotation and revocation. It is an
     identifier, never the secret itself.

## Step 6 - Bind the usage

Every intelligent feature is **one entry** in `MODELES`, and that is what keeps
the token ceiling and the cost log per-feature rather than global:

```ts
<USAGE>: { modele: "<model id>", maxTokens: <ceiling> },
```

Token ceiling by profile: `chat` 1200, `traitement` 600, `generation` 2000,
`qr` 400. Size it on the profile rather than leaving it wide: OpenRouter checks
the remaining budget against the maximum POSSIBLE output, so a generous ceiling
can trigger a 402 near the cap on a call that would have been cheap.

**When the brick already existed** (you arrived here from Step 1), also check
that the cap absorbs the added volume:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/ai/ai-setup.mjs" cles
```

Compare `limit` and `limit_remaining` with the monthly estimate for this new
usage. If the new usage clearly does not fit in what remains, say so in one
sentence and offer to raise the cap at openrouter.ai/settings/keys. Never raise
it silently: the cap is the user's decision, and a cap raised behind their back
is not a guardrail any more.

Hand back `MODE=brique`, `FOURNISSEUR=openrouter`, `MODELE`, `PLAFOND_USD`.

## Step 7 - When the user wants a provider directly

Their project, their call. You never block, and you never make them feel
audited. Offer, in this order:

**First, the same brick with their transport.** They keep everything that
matters, only the destination changes:

> I can set it up on your <OpenAI | Anthropic> account. I would keep the same
> single file, `src/server/ai.ts`, so you still get the cost log, the token
> ceiling per feature, and one place to change your mind. Only the destination
> changes. Want me to do it that way?

If they accept, write `src/server/ai.ts` against their provider, keeping the
contract identical (`appelerIA`, the `MODELES` map, the `ai_usage` log, the
per-usage token ceiling, a clear message when the provider says the quota is
exhausted). The template is a model, not a straitjacket: what must survive is
the contract, not the fetch. Mention in one sentence that a spending cap exists
on their side too (project limits at OpenAI, workspace spend limits at
Anthropic), then drop it. Hand back `MODE=brique` with their `FOURNISSEUR`.

**If they refuse the brick as well**, record it and step back. Two writes, so
that no future skill re-opens the question:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/manifest/manifest.mjs" add \
  --project-dir "<project-root>" --kind ai-key --name "<PROJECT_NAME>" \
  --field provider=<anthropic|openai> --field mode=direct \
  --added-by _ensure-ai --note "direct provider, chosen by the user"
```

and a **Conventions** entry through **`_update-claude-md`**:

> AI: this project calls the <provider> API directly, by explicit choice
> (<date>). The plugin's skills follow that choice and do not propose the
> OpenRouter brick.

Then hand back `MODE=direct` with the provider. The calling skill writes its
model call following the project's own pattern. Do not lecture, do not add a
warning: the choice is recorded, that is enough.

## What you never do

- Never write a model call yourself: you install and bind, the caller builds
  the feature.
- Never mint a key without a cap, and never raise a cap without being asked.
- Never re-open a recorded decision.
- Never let a secret cross the conversation: keys go through the masked window
  or through the script that writes them itself.

## Annex - What the cap actually does (verified against OpenRouter's docs)

- An exhausted **per-key** credit limit returns **HTTP 402**, the same status as
  an empty account balance. That is what `src/server/ai.ts` catches to say
  « budget épuisé » instead of a cryptic failure.
- `GET https://openrouter.ai/api/v1/key`, called with the project key itself,
  returns `limit` and `limit_remaining`. Use it to show how much of the budget
  is left rather than making the user guess, and to warn before the wall.
- Third-party reports (not in the official docs, so do not present it as
  certain) say the remaining budget is checked against `max_tokens`, the maximum
  POSSIBLE output, not the tokens actually produced. If they are right, a
  generous `max_tokens` can trigger a 402 near the cap on a request that would
  have been cheap. One more reason to size `maxTokens` on the profile rather
  than leaving it wide.
