---
name: optimize
description: "Audit what the app does on the server and what it costs, then fix it. Finds unbounded queries, polling that never stops, missing caching, binaries served from the database, N+1 reads, and work redone on every request. Cross-references the code with the real consumption of the free plans (Neon egress and compute, R2, Vercel) so findings are ranked by measured cost, not by count. Produces a report with an estimated gain and a regression risk per finding, then applies the validated fixes on a separate branch. Use when a quota alert arrives, when the app feels slow on the server side, or for a periodic checkup."
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; uses the project's git, pnpm, and the Neon key from the vault when a database is present."
---

# Optimize - Server-side and data-access audit

You audit what the app **does on the server** and what it **costs**, then you propose fixes on a separate branch so the user can check before merging. You speak the user's language (see Communication).

## Where this skill stops, and where its neighbours start

Say this boundary out loud if the user seems to expect something else. Three skills audit a project, and confusing them wastes their time:

| Skill | Scope |
|---|---|
| `/eco-audit` | What the **browser** downloads and renders: images, unused JS, HTTP cache, third-party scripts |
| **`/optimize`** | **What the server does and what it consumes: queries, caching, quotas** |
| `/clean` | What is **no longer used** and can be deleted |

`/optimize` never deletes a feature. If a finding turns out to be dead code, hand it to `/clean` rather than removing it here.

---

## Communication

- Detect the user's language from the conversation (the user's own messages, anywhere in the session - a bare slash command carries no language signal by itself). If nothing gives a signal, fall back to the OS locale (`node -e "console.log(Intl.DateTimeFormat().resolvedOptions().locale)"`) before defaulting to English. ALWAYS reply in that language, including any example text quoted in this skill, which is illustrative and must be translated, never sent verbatim.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.

---

## Educational rule (important)

The report must be **readable by someone who is not a developer**. They know what they want, not the vocabulary.

- The unit that matters to them is **money and quota**, not milliseconds. Say "this screen sends 336 MB a day out of your 5 GB monthly allowance", not "unbounded findMany".
- When you use a technical term, rephrase it immediately the first time. Example: *"an unbounded query (it asks the database for everything, with no limit on how much comes back)"*.
- Everyday analogies help: an unbounded query = "ordering the whole menu when you only wanted the dessert list"; polling that never stops = "calling the shop every ten seconds to ask if they are still open, all night long".
- For each check you ask them to run, **explain what the check is for**, not just the action. Bad: *"check whether this screen displays the content"*. Good: *"open the Academy page and confirm you only see titles there. If you actually read the lesson text on that screen, tell me, the fix changes."*
- Never be condescending. They are intelligent, they just do not know this domain.

This rule applies to the **report** (Step 4) and to the **questions you ask** (Step 5). In your internal scan (Steps 1 to 3) you can stay brief and technical, nobody reads it.


---

## Golden rule - do not make the user do what you can do yourself

Everything technically verifiable, you verify yourself before producing the report. You return only what they alone can decide.

**You do yourself**: read the code, run the detectors, query the Neon consumption API, measure a payload with a SQL query, check whether a query result is actually consumed by a component, run `tsc` and `lint`.

**You ask the user**: whether a screen genuinely needs to feel live (that is a product decision, not a technical one), and whether they accept each fix.

---

## Step 0 - Preflight

1. Invoke `_detect-project-root` to get `WEB_DIR` and `IS_MONOREPO`.
2. Detect whether a database is wired: a real `DATABASE_URL` in the `.env` (not a placeholder). If there is none, the database categories are skipped and you say so plainly rather than reporting "nothing found".
3. Check the working tree is clean (`git status --porcelain`). If it is not, say so and offer to continue anyway (the fixes will land on a separate branch either way).

---

## Step 1 - Measure the real consumption first

**This step is what makes this skill different from a linter, so never skip it.** A pattern found in the code means nothing until you know what it costs. This is also what lets you rank findings honestly.

If a Neon database is present, read the key from the vault (`_get-secret`, item `NEON`, field `api_key`) and query the consumption of every project of the account:

```bash
# List the projects, then read each one individually: the list endpoint does NOT
# carry the consumption counters, only the per-project endpoint does.
curl -s "https://console.neon.tech/api/v2/projects?limit=400" -H "Authorization: Bearer $KEY"
curl -s "https://console.neon.tech/api/v2/projects/<id>" -H "Authorization: Bearer $KEY"
```

For each project, the fields that matter are `data_transfer_bytes` (egress), `compute_time_seconds`, `active_time_seconds` and `consumption_period_start`/`_end`.

Three readings to take, and to state in the report:

- **Egress against the 5 GB cap.** This cap is **pooled across the whole account**, unlike storage and compute which are per project. A single project can therefore exhaust everyone else's allowance.
- **The daily pace**, projected to the end of the billing period. A number without a trajectory tells the user nothing.
- **Active time against elapsed time.** A database that is awake 160 hours out of 180 never gets to suspend, which means something is querying it around the clock. That ratio alone often points at the culprit before you have read a single line of code.

If other services are configured, reuse `scripts/quotas-fetch.mjs` and `scripts/quotas-limits.json` rather than re-implementing the calls.

### Instrument before searching, when the totals do not add up

Reading the code tells you what *can* be expensive. It does not tell you what *is* running. When the account-level figures and what you find in the code disagree, stop reading and instrument, or you will spend hours fixing something real that happens not to be the emitter.

Postgres records execution counts per query fingerprint. On Neon the extension is preloaded, so a single statement exposes it, and the counters are often **already populated** for the current compute session:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT calls, rows, query FROM pg_stat_statements ORDER BY calls DESC LIMIT 20;
```

Two things to know before reading the output, both of which will mislead you otherwise:

- **The window is the compute session, not the month.** Check it with `SELECT now() - pg_postmaster_start_time()`. If the compute restarted twenty minutes ago you are looking at twenty minutes, and a per-day extrapolation from that is worthless. Say so rather than pretending.
- **The top of the list is Neon's own agents, not the application.** `pg_stat_activity`, `pg_replication_slots`, `neon.neon_perf_counters`, `SELECT $1` and friends run several times a second, and they are local to the compute, so they cost no egress at all. Filter on your own tables, or on `query NOT ILIKE '%pg_%'`, before drawing any conclusion.

What you are looking for is a **cadence**: an application query whose `calls` divided by the window gives one every few seconds or minutes, when nothing in the code declares such an interval. That gap between the declared interval and the observed cadence is the finding. It is what reveals both traps below, the route that believes it is cached and the client refetching on focus.

---

## Step 2 - Deterministic scan

Seven categories. Each is a search over the project source, and each finding must be **verified by reading the code** before it enters the report: a grep hit is a lead, not a conclusion.

### 2a - Unbounded queries

Look for: a bare `.select()` (which is `SELECT *`), a `findMany` with neither `columns` nor `limit`, a query returning a wide column that no screen displays (long text, JSON, logs, generated content).

**Measure the payload rather than guessing.** With the database at hand you can weigh the real thing, using the plugin's SQL helper (SQL-over-HTTP, since port 5432 is often blocked):

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/neon/run-sql.mjs" "SELECT ..."
```

```sql
SELECT pg_size_pretty(SUM(octet_length(row_to_json(t)::text))::bigint)
FROM (SELECT * FROM <table> LIMIT <the query's limit>) t
```

Then weigh the same query restricted to the displayed columns. The gap between the two is the gain, in bytes, and it is what you put in the report.

### 2b - Polling that never stops

Look for `refetchInterval`, `setInterval`, and any repeated fetch loop.

⚠️ **The rule is not "no short interval", it is "no short interval without a stop condition".** A progress bar polling every 2 seconds while a job runs, and stopping the moment it ends, is correct and must NOT be reported. What must be reported is a poll that keeps going when nothing is happening.

To tell them apart: a `refetchInterval` given as a **function** that can return `false` is the healthy shape. A numeric literal is the suspicious one. Multiply the payload by the frequency to state the daily cost.

Also worth knowing, and worth explaining to the user: a tab left open on a second screen still counts as visible, so it keeps polling all day even though nobody is looking at it.

**Do not stop at `refetchInterval`, check the client defaults too.** React Query refetches every mounted query on window focus by default, so with a short `staleTime` every single alt-tab back to an open tab replays the whole screen's queries. In the statistics this shows up as a full cluster of queries replayed at irregular 2 to 5 minute intervals, with no interval declared anywhere in the code. Look at where the `QueryClient` is built (`staleTime`, `refetchOnWindowFocus`): the healthy shape on a database-backed admin is a `staleTime` of about a minute and `refetchOnWindowFocus: false`, freshness after an action coming from the mutation's own invalidations.

⚠️ **An already-open tab runs the old bundle.** Deploying a polling fix changes nothing in a tab that has not been reloaded. Before concluding that a fix failed to move the numbers, make sure the tabs were reloaded, and tell the user to do it.

### 2c - Caching and rendering

Look for `force-dynamic` or `revalidate` below 600 on a page or route that reads the database. The database suspends after 5 minutes without a query; anything more frequent keeps it awake around the clock and burns the monthly compute hours.

Legitimate exceptions, not to be reported: cron and webhook routes (rare, authenticated), admin pages, and pages whose database reads sit behind a tagged `unstable_cache`.

⚠️ **The trap that hides the worst offenders: a route that declares `revalidate` but is dynamic anyway.** In the App Router, a single `fetch(..., { cache: "no-store" })` anywhere in the handler **silently cancels `export const revalidate`** for the whole route. Nothing warns at build time, and the `// ISR 1 h` comment at the top of the file stays there, lying. Every incoming request then runs the handler, database reads included.

So do not trust `export const revalidate` on its own. In every file that declares it, search for `no-store`, `cache: "no-store"`, `noStore()` and `headers()`/`cookies()` reads, all of which force dynamic rendering. A file that has both is a confirmed finding, not a suspicion.

**This is where the most expensive findings hide**, because the routes concerned are usually **public and polled by machines around the clock**: RSS and podcast feeds (aggregators poll every few minutes, forever), sitemaps, OG image endpoints, webhooks-facing status pages. A screen that a human opens costs nothing next to a feed that fifty aggregators pull day and night.

Measured on this very stack in August 2026: a podcast RSS feed believed to be on a one-hour ISR was in fact executing about 27 times an hour, each run re-reading every edition row in full, around 200 MB of egress a day. It was the single largest consumer of the whole account, and two days of fixes on dashboard polling had not moved the curve because the real emitter was this one.

**The fix that actually holds is `unstable_cache`, not `revalidate`.** Wrap the data building (or better, the whole response body, returned as a string) in an `unstable_cache` with a TTL and a tag. Unlike `revalidate`, it is immune to internal fetches: the database is read once per TTL whatever the route's dynamism and whatever the incoming rate. Returning a finished string also avoids `Date` rehydration problems in the cached value.

### 2d - Binaries served from the database

Look for columns holding file content, and routes that rebuild a file (zip, PDF, image) from database rows on every request.

This is the most expensive pattern per request and the least visible. Object storage (`/add-storage`) is where these belong; its outbound traffic is not metered the same way. A signed-URL redirect costs nothing at all.

### 2e - N+1 reads

Look for a query inside a loop or a `map`, and for a page that fetches a list and then fetches each item separately. Report the number of round trips as a multiplier, it is the figure that speaks.

### 2f - Work redone on every request

Look for repeated reads with no server-side cache (`unstable_cache`, `revalidateTag`), and heavy computation performed on every render rather than once.

### 2g - Client/server boundary

Look for `"use client"` on components that carry no interactivity, and for data fetched on the client that a server component could have read once.

---

## Step 3 - Targeted reading pass (not scripted)

**This step catches what no rule anticipates, so do not skip it because the detectors came back quiet.**

Start from the two most expensive findings of Step 1 and read those files properly. Look for what a pattern search structurally cannot see:

- **Data fetched and never consumed.** A query whose result no component ever reads. It happens: a query kept alive only so something can call `refetch()` on it, while its payload is thrown away every time. A detector sees a legitimate-looking query; only reading the component reveals the waste.
- **Results partially used.** A whole row fetched for a single boolean.
- **Invalidations broader than necessary.** A save that reloads an entire list when it changed one field, or when the list does not even display the field that changed.
- **Duplicate calls between components mounted together.** Two components on the same screen asking for the same thing.
- **The same data read on every request when it changes once a week.**

For each, say plainly what you read and what convinced you. A finding from this pass carries more weight than a grep hit, so it deserves its reasoning.

---

## Step 4 - Consolidated report

**You audit first, you report, and only then does the user decide. Never fix anything before this report has been read and validated**, not even something that looks obvious to you.

Rank by **measured cost**, not by category or by count. Apply the educational rule.

Three axes per finding, and they answer three different questions. Do not collapse them:

- **Confidence**: am I sure this is really a problem? A grep hit that I could not verify by reading the code is 🔴 Low, whatever its apparent cost.
- **Danger of fixing it**: what breaks if I am wrong, or if the fix has a side effect?
- **Estimated gain**: what it saves, in a unit the user can act on.

```
[🔴🟡🟢] <File / screen / query>
  Category        : <category>
  In plain terms  : <what this code does, in everyday language>
  Confidence      : 🟢 High | 🟡 Medium | 🔴 Low (+ what I checked to get there)
  Danger if fixed : 🟢 Low | 🟡 Medium | 🔴 High (+ one sentence on what could break)
  Estimated gain  : <in MB/day, GB/month, or compute hours - and how you got there>
  Why it costs    : <short explanation, no jargon>
  Proposed fix    : <what you would change, in one or two sentences>
  To check before accepting :
    - <concrete check + what the check is for>
```

Example render (excerpt) for a non-technical user:

```
🔴 The "Academy" admin page
  Category        : Query that reads too much
  In plain terms  : To show you the list of your 64 course modules, this page asks the
                    database for the entire text of every one of them - the full lesson
                    content - when the list only displays their titles. It is like
                    ordering the whole menu when you only wanted to read the desserts.
  Confidence      : 🟢 High - I read the page. It shows titles, order and a few badges.
                    None of the lesson content appears anywhere on that screen.
  Danger if fixed : 🟢 Low - this kind of change is checked automatically when the code
                    compiles. If a field were missing, it would fail immediately and
                    visibly, rather than silently.
  Estimated gain  : 325 kB per load, down to 14 kB. The page reloads after every save and
                    every time you come back to the tab, so an afternoon of editing sends
                    a few hundred megabytes for nothing.
  Why it costs    : Your allowance is not counted in "how big is my database" but in
                    "how much did it send out". A small database read often costs far
                    more than a big one read rarely.
  Proposed fix    : Ask only for the columns the page shows, and stop reloading the whole
                    list after a save that did not change it.
  To check before accepting :
    - Open the Academy page and confirm you only see titles and badges there, no lesson
      text. If you do read the lesson content on that screen, tell me: the fix changes.
```

Confidence is earned by verification, not by the strength of the pattern. Say what you actually did: *"🟢 High - I read the component, none of the six fields returned by this query is displayed anywhere on the screen"* carries weight. *"🟡 Medium - the query looks oversized, but this screen may be used by an admin page I have not found"* is honest and just as useful.

Open the report with an executive summary: where the account stands against the caps, the projected date the cap is hit if nothing changes, and the total gain of the proposed fixes. Then the findings.

If a category came back empty, say so. "I checked whether your app serves files from the database, it does not" is information, and it stops the user wondering.

### Reference - typical confidence, gain and danger by category

| Category | Typical confidence | Typical gain | Danger if fixed |
|---|---|---|---|
| Public route believed cached but dynamic (`no-store`) | 🟢 High (the cadence proves it) | 🔴 **Highest** | 🟢 Low (`unstable_cache` changes nothing visible) |
| Unbounded query on a wide table | 🟢 High (measurable) | 🔴 High | 🟢 Low (typed, `tsc` catches a missing column) |
| Polling with no stop condition | 🟢 High (readable in the code) | 🔴 High | 🟡 Medium (a screen may refresh less often) |
| Refetch on window focus with a short staleTime | 🟢 High (visible in the stats) | 🔴 High | 🟡 Medium (a screen refreshes on action, not on focus) |
| Binary served from the database | 🟢 High | 🔴 High | 🟡 Medium (touches a download path, keep a fallback) |
| `force-dynamic` on a public page | 🟡 Medium (may be deliberate) | 🟡 Medium | 🟡 Medium (content becomes slightly less fresh) |
| N+1 | 🟢 High | 🟡 Medium | 🟢 Low |
| Missing server-side cache | 🟡 Medium | 🟡 Medium | 🟡 Medium (staleness window to agree on) |
| Data fetched and never used | 🟡 Medium (prove it) | varies | 🟡 Medium (may be read somewhere you missed) |
| Needless `"use client"` | 🔴 Low | 🟢 Low | 🟡 Medium (can break an interaction) |

A 🔴 Low confidence finding still goes in the report, clearly labelled. It is then a question for the user, not a proposal: they may know the reason you could not find.

### What you must NOT report

Being wrong once costs you the user's trust for good, so hold the line on these:

- A short poll that stops on its own when the job ends.
- A `force-dynamic` on a cron, webhook, or admin route.
- A query that is already restricted to its displayed columns, even if it looks big.
- A micro-optimisation with no measurable gain. If you cannot put a number on it, it does not belong in the report.

---

## Step 5 - Validation, one finding at a time

Present the findings in order and let the user accept or decline each one. **Never apply a batch on a single global "yes"**, and never treat silence or enthusiasm about the report as approval to change code.

Start with the 🔴 Low confidence ones, as questions rather than proposals: they often resolve in one sentence from the user, and that answer sometimes reclassifies a neighbouring finding too.

For anything touching how live a screen feels, ask the product question explicitly, because you cannot decide it for them: *"This screen currently refreshes every 10 seconds. Do you need it to feel live, or is a refresh when you come back to the tab enough?"* If they do need it live, the answer is an event (a webhook, a `revalidateTag` in the mutation that publishes, a push notification), never a shorter interval. Say so.

---

## Step 6 - Apply on a separate branch

Same discipline as `/clean`:

1. Create a branch (`optimize/<date>`).
2. Apply the accepted fixes, one commit per finding so any single one can be reverted alone.
3. Run `pnpm tsc --noEmit` and `pnpm lint`. Never `pnpm build`.
4. If the project has a preview, check the affected screens still work.
5. Hand back the branch and let the user merge.

Never apply automatically, and never push or deploy without explicit consent.

---

## Step 7 - Summary and follow-up

Recap what was changed, the expected gain, and **the reading to take again in a few days**: consumption counters move slowly, so the proof that it worked arrives later. Give the user the figure to compare against, and offer to take the reading yourself when they ask.

If findings were declined, say what remains on the table without insisting.
