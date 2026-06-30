---
name: clean
description: "Audit the project to find what is no longer used - orphan files, dead code, AI leftovers, unused dependencies, orphan env vars, DB tables with no caller, obsolete migrations. Produces a report with a certainty level and a danger level for each finding, then applies the validated deletions on a separate branch (code + Neon DB) for verification before merge."
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Clean - Project hygiene audit

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You audit the project to find what is no longer used, then you propose deletions **on a separate branch** so the user can verify before merging.

**Disclaimer to display at the start of the audit:**

> ⚠️ This report is a diagnostic. Some findings are false positives: your code may use elements in a way that static analysis cannot detect (dynamic imports, references in the database, an env var read by a transitive dependency, external links to pages, and so on). **Nothing will be deleted without your explicit approval**, and the deletions will be made on a separate branch that you test before merging.

---

## Educational rule (important)

The report must be **readable by someone who is not a developer**. You may be dealing with a user who knows what they want, but not all the technical jargon.

**Concrete rules:**

- When you use a technical term, explain it immediately in parentheses the first time it appears. Example: *"An unused export (a function or component exposed by a file, but that no other file picks up)"*.
- When you can, prefer a common rephrasing and put the technical term in parentheses. Example: *"This file contains bits of code that are saved but never called (dead code)"*.
- Use everyday analogies for abstract concepts: a `.bak` file = "a forgotten photocopy", an unused dependency = "a tool in the toolbox that no one uses", a DB table with no caller = "a storage room that no one has the key to".
- For the checks the user has to do, **explain what verifying it is for** - not just the action to take. Example of a bad phrasing: *"Check `grep -r 'Foo'`"*. Example of a good phrasing: *"Open a terminal and type `grep -r 'Foo' src/` - you should only see the file that defines Foo. If you see other files, that means Foo is used somewhere, and you must not delete it."*
- Never be condescending. The user is intelligent, they just do not know this domain.

This rule applies to the report (step 2) and to the proposed checks (step 3). In your internal scan (step 1), you can stay brief.

---

## Golden rule - do not make the user do what you can do yourself

This is the most important rule of this skill. **Everything that is technically verifiable, you verify yourself** before producing the report. You return to the user **only** the questions that they alone can decide.

### What you MUST do yourself (never ask the user)

- Run `grep` / `find` searches in the code → you have the tool.
- Read the content of a config file (`.env`, `package.json`, `drizzle.config.ts`) → you have the tool.
- Look up the value of a Vercel env var → run `vercel env pull .env.vercel-check --yes` (all of them into a temp file), read the values, then `rm .env.vercel-check`.
- Check the state of a Neon DB (tables, row counts) → helper `node "${CLAUDE_SKILL_DIR}/../../scripts/neon/run-sql.mjs" "SELECT ..."` (SQL-over-HTTP, reads `DATABASE_URL` from the `.env`). List/inspect branches → Neon REST API (`GET https://console.neon.tech/api/v2/projects/{id}/branches`, key `NEON.api_key` from the vault).
- Verify a deployment, logs, a CLI auth → you have the CLIs (`gh`, `vercel`, `wrangler`, `render`).
- Recount a number of imports or usages - even if you already verified it in your internal scan, do not ask the user to re-type the command.

**In the report, present these checks as facts**, not as homework for the user. Examples:

- ❌ *"To verify before deleting: open your editor, do `Ctrl+Shift+F` on 'db.select', you should get 0 results"*
- ✅ *"Verified: 0 occurrence of `db.select / db.insert / db.update / db.query` in `src/`."*

- ❌ *"To verify: run `vercel env pull` and check whether `DATABASE_URL` is a fake localhost"*
- ✅ *"Verified on Vercel: `DATABASE_URL` = `postgresql://placeholder:placeholder@localhost:5432/db` (fake value left by the bootstrap, never used)."*

### What you MUST ask the user (you cannot know it)

- A **product / roadmap decision**: *"Are you planning to add a DB / a blog / a members area in the coming weeks?"*
- An **external reference** that static analysis cannot see: *"Did you share the URL of this image in a newsletter, a LinkedIn post, a marketing email? I do not have access to those channels."*
- An **intent** behind an old code choice: *"This component exists in two versions (X and XOld) - was XOld kept on purpose (fallback, external A/B test), or forgotten after a migration?"*

Keep the "To verify" list short and human. If you verified everything yourself, this section can simply be absent - replaced by a "Checks done:" line that lists the technical checks already performed.

---

## Progress communication

At startup, **display a checklist** in natural language (not "Step N"). During execution, announce each action with `↳ …` then mark `✅` once done. At the end, every box must be `✅`. NEVER mention the internal step numbers to the user.

Example of an opening checklist:

> Here is what I am going to do:
> - ⬜ Scan orphan files
> - ⬜ Detect dead code (exports, imports, unreferenced pages)
> - ⬜ Spot AI leftovers (stubs, TODOs, duplicates)
> - ⬜ List unused dependencies
> - ⬜ Compare environment variables .env ↔ code ↔ Vercel
> - ⬜ Check DB tables with no caller
> - ⬜ Check obsolete Drizzle migrations
> - ⬜ Do a global checkup (look beyond the planned categories)
> - ⬜ Produce the report with certainty and danger levels
> - ⬜ If you approve, create a cleanup branch (code + DB) and apply

---

## Step 1 - Scan by category

Go through each category and **keep the findings silently**. Only display them in step 2 (consolidated report).

### 1a - Orphan files

Search at the root and in `src/`, `scripts/`:

- Suspicious extensions: `*.bak`, `*.tmp`, `*.old`, `*.orig`, `*.backup.*`
- Name patterns: `_old-*`, `*-old.*`, `*-copy.*`, `*-copie.*`, `*_v1.*`, `*_v2.*`, `*-test.*` (if there is no test runner), `temp-*`, `_tmp*`
- Forgotten SQL dumps: `*.sql` outside the `drizzle/` folder or migrations
- One-shot scripts at the root: `migrate-*.ts`, `fix-*.ts`, `seed-once.ts`, `debug-*.ts`
- Leftover notes: `NOTES.md`, `TODO.md`, `TEMP.md`, `scratch.md`

**Tool**: `find` or `git ls-files` + filter.

### 1b - Dead code

- **Unused imports**: via `pnpm tsc --noEmit` (already covered by TS) or the linter (`pnpm lint`).
- **Unused exports**: if `knip` or `ts-prune` is available (`pnpm dlx knip` works without install), use it. Otherwise, manual grep: for each named export in `src/`, `grep -r "exportName" --include="*.ts" --include="*.tsx"` outside the declaration file. If 0 results, it is a candidate.
- **Unimported React components**: list the `.tsx` files under `src/components/` that are not imported anywhere.
- **Orphan pages / API routes**: `src/app/**/page.tsx` and `src/app/api/**/route.ts` that no other file references via `href=`, `<Link>`, `fetch(`, `router.push(`, or via the sitemap / navigation. Careful: a page can also be reachable via an external link / a marketing email / a manually typed URL.
- **tRPC functions (procedures) not called** on the client side: for each `.query`/`.mutation` of the router, check that there is at least one `api.X.Y.useQuery` / `api.X.Y.useMutation` / `await api.X.Y(...)` in `src/`.

### 1c - AI leftovers

Typical traces left by Claude / Cursor / Copilot:

- Verbose comments: `// This function takes X and returns Y`, `// Here we iterate over the array`, `// eslint-disable-next-line` without justification
- Forgotten TODO markers: `// TODO (Claude)`, `// TODO: implement`, `// FIXME`, `// STUB:`
- Duplicated names: `Button.tsx` + `Button2.tsx`, `UserForm.tsx` + `UserFormNew.tsx`, `index.ts` + `index.old.ts`
- Forgotten plan / prompt files: `_plan.md`, `prompt.txt`, `steps.md` at the root
- Forgotten console logs: `console.log(`, `console.debug(` in non-test code (to **flag**, not to delete automatically since they are sometimes intentional)
- Diff comments: `// removed`, `// was: xxx`, `// (old implementation)`

### 1d - Unused dependencies

Run `pnpm dlx depcheck` (or `pnpm dlx knip --dependencies`) and capture the result.

**Frequent false positives** to flag as "to verify manually":
- Packages used only via their CLI (e.g. `drizzle-kit`)
- Dynamically loaded packages
- Peer deps required by another dep
- Types (`@types/*`) that are only used implicitly

### 1e - Environment variables

Compare three sources:
1. Local `.env` (listed keys)
2. Code: `grep -r "process\.env\." src/` → list of vars read
3. Vercel: `vercel env ls` (if the CLI is authenticated)

Three types of findings:
- **In .env / Vercel but NEVER read in the code** → deletion candidate. ⚠️ Moderate danger: some vars are read by deps (e.g. `NEXTAUTH_URL`, `DATABASE_URL` by Drizzle, `VERCEL_URL`, `NODE_ENV`).
- **Read in the code but absent from .env / Vercel** → not a leftover, but a **potential bug** to flag.
- **In local .env but not on Vercel (or the reverse)** → desynchronization to flag.

### 1f - DB tables with no caller

Read `src/server/db/schema.ts` (or equivalent), extract the table names and their exported variables. For each one, check that there is at least one `grep` that references it on the code side (`db.select().from(X)`, `db.insert(X)`, import `{ X } from "...schema"`).

⚠️ The riskiest category of the report - see danger level below.

### 1g - Obsolete Drizzle migrations

List the files in `drizzle/` (or `src/db/migrations/`).

- If the project uses `db:push` (no versioned migrations) → no action.
- Otherwise, flag the orphan JSON snapshots (numbers that no longer match a `.sql`) or the migrations whose content is entirely cancelled out by a later migration (added then removed the same column).

### 1g-bis - "Ready-to-use" scaffolding (to classify separately, not as leftover)

**This is the most important distinction of the skill.** The Hypervibe plugin (and T3, and shadcn/ui) intentionally scaffold elements that are not used right away, but that are **ready to wire up** as soon as the user needs them. These elements:

- are useless today in the code
- **but** have a near-zero cost to keep
- **and** would be painful to recreate exactly the same (version, config, typing) if we deleted them and then had to put them back

**The rule: you do NOT propose them as leftovers to validate.** You list them in a separate section of the report, `ℹ️ Ready-to-use scaffolding - recommendation: keep`, purely informational. The user can always ask to remove them if they wish, but the default is to keep them.

#### Elements typically in this category

- **Complete DB stack** when the `DATABASE_URL` is a placeholder like `postgresql://placeholder@localhost:5432/*` and no query is made:
  - Files: `src/server/db/schema.ts`, `src/server/db/index.ts`, `drizzle.config.ts`, `start-database.sh`
  - Deps: `drizzle-orm`, `drizzle-kit`, `postgres`, `eslint-plugin-drizzle`
  - **`package.json` scripts**: `db:push`, `db:studio`, `db:generate`, `db:migrate` - they are an integral part of the DB kit, keep them as long as the DB stack is kept. Removing them would make the stack unusable even if we wire it up later.
  - `db` context in `src/server/api/trpc.ts`
  - This whole block is the DB layer left pre-wired by the bootstrap so that `/add-db` can plug in a real DB later without re-scaffolding.
- **tRPC SSR helpers** (`src/trpc/server.ts`, `createCaller` in `src/server/api/root.ts`): 30 lines of T3 boilerplate to call tRPC on the server side without going through the network. Low cost to keep, painful to recreate by hand if the need comes back.
- **Exported but unused tRPC types** (`RouterInputs`, `RouterOutputs` in `src/trpc/react.tsx`): standard T3 boilerplate (`type RouterInputs = inferRouterInputs<AppRouter>`), 2-3 lines, useful as soon as a component needs to type an input/output of a query/mutation. **Keep**.
- **shadcn/ui components in `src/components/ui/`**: **all of them**, without exception, whether they were installed at bootstrap or added later. Even unused today, they are part of the coherent UI kit (same version, same imports, same Tailwind variants). Cost to keep = none, cost to recreate consistently with the rest of the kit = non-trivial. **Never propose a shadcn component as a leftover**, even if it is imported nowhere.
- **Default healthcheck router / route** scaffolded by the bootstrap and never called: "ready to monitor" pattern, we keep it.

#### What is NOT scaffolding (to treat as normal dead code)

Conversely, some files look like scaffolding but are not. **T3 does not create them** - they were added manually or by an earlier Claude conversation:

- `src/components/**/index.ts` (barrel re-exports): T3 and Hypervibe do not generate any. If you find one that is never imported, it is a human/AI addition that you can propose for normal deletion (🟢 low risk).
- Custom React components in `src/components/<domain>/` that are never imported: not scaffolding, real dead code.
- Utilities in `src/lib/` other than those explicitly shipped by T3 / Hypervibe (`cn.ts`, `utils.ts` from shadcn): same, verify the origin before deciding.

#### How to recognize "ready-to-use scaffolding" rather than dead code

Three signals that help you decide:

1. **The element has a visible placeholder** (fake DATABASE_URL, "replace with your …" comment) → scaffolding.
2. **The element is part of a standard T3 / shadcn / Hypervibe pattern** → scaffolding.
3. **Deleting the element would amount to removing a capability** (not just a line of code) → scaffolding.

If all three are false → it is real dead code and you put it in category 1b.

#### Format in the report

```
ℹ️ Ready-to-use scaffolding (recommendation: keep)

- Complete DB stack (Drizzle + Postgres + placeholder DATABASE_URL)
  Reason: pre-wiring left by /bootstrap to plug in a real DB via
  /add-db without re-scaffolding. Not used today, but cost to keep
  = none, cost to recreate = 10-15 min + risk of version drift.
  Suggestion: keep. If you are sure you will never wire up a DB,
  tell me "remove the DB stack" and I will do it.

- src/trpc/server.ts + createCaller
  Reason: standard T3 helper for server-side tRPC calls. ~30 lines.
  Suggestion: keep.

- shadcn/ui components: avatar, scroll-area, separator
  Origin: installed in a batch by the bootstrap (seen in the initial commit).
  Suggestion: keep. They are part of the version-coherent kit.
```

You can also, if you detect an ambiguous case (e.g. a shadcn component that was added in a later commit), flag it as `🟡` in the normal category rather than as scaffolding.

### 1h - Global checkup (outside the planned categories)

**Do not stop at the 7 categories above.** Go through the project with the meticulous eye of a newcomer, and flag anything that strikes you as odd / useless / dated, even if it does not fit any predefined box.

Examples of possible findings (non-exhaustive list, for inspiration):

- **Assets in `/public/` never referenced** in the code nor the legal pages (images, PDF, favicon v1 replaced by v2, fonts loaded twice).
- **i18n translation keys** defined in `src/messages/*.json` but never called via `t("...")` / `useTranslations`.
- **Same URL path defined twice** (e.g. an `app/contact/page.tsx` AND an `app/(marketing)/contact/page.tsx` - Next.js will only keep one of the two).
- **Feature flags turned into constants**: `if (FEATURE_X)` conditions where `FEATURE_X` is always `true` (the flag can be removed and the code simplified).
- **Commented-out code** left "just in case" for several commits (visible via `grep -r "^\s*//" src/` and by looking at the big blocks).
- **Empty or near-empty files**: `.ts`/`.tsx` of fewer than 10 lines with no useful export.
- **Tests referencing deleted code**: a `.test.ts` whose tested file no longer exists.
- **Docker / Kubernetes / Heroku config** if the project is now on Vercel and those files no longer run.
- **README.md** that documents steps or features that no longer exist in the code.
- **`shadcn/ui` components generated but never used** in `src/components/ui/` (they are committed as is - we can remove the ones that serve no purpose).
- **Historical seeds / setup scripts** that reference tables or columns that no longer exist in the schema.
- **Dead config settings** (`next.config.js`, `tsconfig.json`, `eslint.config.mjs`, `drizzle.config.ts`): commented-out options, empty `experimental: {}`, ESLint rules disabled without a documented reason.
- **Logic duplicates**: two utils that do the same thing (`formatDate` in `lib/utils.ts` AND in `lib/date.ts`), two near-identical Zod validators, etc.
- **`package.json` with a default `name`** (`"test"`, `"my-app"`, `"t3-app"`, `"create-next-app"`, or a name that matches neither the folder nor the GitHub repo): a vestige of a scaffold whose name no one changed. Rename it to kebab-case consistent with the project (derived from the folder or from the `repo` in `git remote get-url origin`). Safe to fix - zero runtime impact, just cleaner in the logs and in `pnpm --filter`.

For each finding outside the categories, use the same format as the others (certainty + danger + checks). In the category, note it under **"Other findings"** in the report.

---

## Step 2 - Consolidated report

For **each finding**, display in the following format. Apply the educational rule: each technical term is accompanied by a rephrasing in parentheses the first time it appears.

```
[🟢🟡🔴] <File / symbol / table name>
  Category    : <category>
  In plain terms : <rephrasing in everyday language - what it is, what it normally does>
  Certainty   : 🟢 High | 🟡 Medium | 🔴 Low
  Danger if wrongly deleted : 🟢 Low | 🟡 Medium | 🔴 High (+ a sentence that concretely explains what would break)
  Why it might be a leftover :
    <short explanation, no jargon>
  To verify before deleting :
    - <check 1 - concrete action + what the check is for>
    - <check 2>
```

Example render (excerpt) for a non-technical user:

```
🟡 src/components/OldSignupForm.tsx
  Category    : Unimported component
  In plain terms : A signup form (a React component - an interface building block) that is no
                longer wired to any page.
  Certainty   : 🟡 Medium
  Danger if wrongly deleted : 🟢 Low - if no one uses it, the site will not change.
                If by chance it is loaded dynamically, a page will error out - you would see it
                right away by clicking on that page.
  Why it might be a leftover :
    There is a SignupForm.tsx (without the "Old") that is more recent, and that is the one used
    everywhere in the project.
  To verify before deleting :
    - Open your editor, do a global search (Ctrl+Shift+F) for "OldSignupForm".
      You should only see this file itself. If you see an `import OldSignupForm …` somewhere,
      that means it is still used - we do not touch it.
    - Quickly check whether a page on the site still uses the old form
      (the "oldest" pages of the project, typically).
```

### Reference - certainty and danger by category

| Category | Typical certainty | Danger if wrong |
|---|---|---|
| `.bak` / `.tmp` / `_old-*` file | 🟢 High | 🟢 Low (recoverable via `git log --diff-filter=D`) |
| One-shot script at the root | 🟡 Medium | 🟢 Low (it could be a useful archived script) |
| Unused import | 🟢 High | 🟢 Low (lint / tsc catches it immediately) |
| Unused export (internal util) | 🟢 High | 🟢 Low (breaks at compile time) |
| Export from a lib `index.ts` file | 🟡 Medium | 🟡 Medium (might be a public API of the package) |
| Unimported React component | 🟡 Medium | 🟢 Low (if truly unused, 0 visual effect) |
| Orphan `app/**/page.tsx` page | 🔴 Low | 🔴 **High** (external links / SEO / email shares) |
| Orphan API route `app/api/**/route.ts` | 🔴 Low | 🔴 **High** (external webhook, mobile app, third-party integration) |
| tRPC procedure not called on the client | 🟡 Medium | 🟡 Medium (might be called in SSR or via another front end) |
| Verbose AI comment | 🟢 High | 🟢 None (no behavior) |
| Forgotten TODO marker | 🟢 High | 🟢 None (but may hide an undone task worth recalling) |
| Component duplicate (`X2.tsx`) | 🟡 Medium | 🟡 Medium (which of the two is used?) |
| Forgotten console.log | 🟡 Medium | 🟢 Low (but sometimes intentional in dev) |
| `depcheck` dependency | 🟡 Medium | 🟢 Low (reinstallable, the lockfile keeps a trace) |
| Env var in .env never read in the code | 🟡 Medium | 🔴 **High** (a transitive dep may read it, e.g. NEXTAUTH_URL) |
| DB table with no caller | 🔴 Low | 🔴 **Very high** - never delete without a backup + human validation |
| Old Drizzle migration already applied | 🟢 High | 🟡 Medium (useless, but breaks nothing if left) |
| Asset in `/public/` not referenced | 🟡 Medium | 🟡 Medium (may be used in an email / external document) |
| Unreferenced i18n key | 🟢 High | 🟢 Low (will show the raw key if called) |
| shadcn/ui component in `src/components/ui/` | - | ℹ️ Never proposed - ready-to-use scaffolding (see 1g-bis) |
| Commented-out code (dead block) | 🟢 High | 🟢 None (git keeps the history) |
| Constant feature flag | 🟡 Medium | 🟡 Medium (may be useful to quickly re-enable the feature) |
| Logic duplicate (identical utils) | 🟡 Medium | 🟡 Medium (make sure both really do the same thing) |
| Other finding outside the categories | to assess case by case | to assess case by case |

**Group the report by decreasing danger level**, so the user first sees the risky things (to study thoroughly) and finishes with the safe things (that they can accept in bulk).

### Executive summary at the top of the report

Before the detail, display:

```
📊 Summary
  Orphan files               : X found (Y high certainty)
  Dead code                  : X found
  AI leftovers               : X found
  Unused deps                : X
  Questionable env vars      : X
  DB tables to verify        : X
  Obsolete migrations        : X
  Other findings (off-category) : X
  ─────────────────────────────
  Estimated gains            : ~X files, ~Y lines, ~Z MB node_modules

ℹ️ Detected but NOT proposed for deletion (ready-to-use scaffolding):
  - DB stack (Drizzle + placeholder DATABASE_URL)
  - tRPC SSR helpers
  - shadcn components installed at bootstrap: X
  → If you want to remove one, ask for it explicitly.
```

---

## Step 3 - Validation by the user

Ask the user to **validate category by category** (not all at once), in **increasing** order of danger (we start with the safe ones):

> Where do we start?
>
> 1. AI comments / forgotten TODOs (🟢 no risk) - X findings
> 2. Unused imports / exports (🟢 no risk) - X findings
> 3. `.bak` / `.tmp` files (🟢 no risk) - X findings
> 4. `depcheck` dependencies (🟢 low risk) - X findings
> 5. Unimported React components (🟡 to verify) - X findings
> 6. One-shot scripts (🟡 to verify) - X findings
> 7. Other off-category findings (variable risk level, to look at case by case) - X findings
> 8. Orphan env vars (🔴 risky) - X findings
> 9. Orphan pages / API routes (🔴 risky) - X findings
> 10. DB tables (🔴 very risky) - X findings
>
> For each category, I will list the items one by one, and you decide which ones to delete.

**For 🔴 categories, NEVER propose a bulk action.** Item by item, with the checks to do explicitly cited.

---

## Step 4 - Separate branch proposal

Once the deletions are validated, **do not touch `main` directly**. Propose:

### 4a - Git branch

```bash
git checkout -b cleanup/YYYY-MM-DD
```

(Name: `cleanup/YYYY-MM-DD` or `cleanup/YYYY-MM-DD-HHMM` if there are several sessions in one day.)

All the deletions (files, code, deps, env vars) happen on this branch. One commit per category to be able to roll back finely:

- `cleanup: remove orphan backup files`
- `cleanup: remove unused exports`
- `cleanup: remove ai leftovers (todo, verbose comments)`
- `cleanup: drop unused deps`
- `cleanup: prune env vars` (⚠️ test very carefully)
- etc.

### 4b - Neon DB branch

If some changes touch the database (deletion of tables, columns, migrations):

1. Create a **Neon branch** from `main` via the Neon REST API (`POST https://console.neon.tech/api/v2/projects/{id}/branches`, key `NEON.api_key` from the vault) or `neonctl branches create`
   - Name: `cleanup-YYYY-MM-DD`
2. Get its `connection_string`
3. Add it to Vercel in the **Preview** environment only (not Production), as `DATABASE_URL` for the previews of the `cleanup/*` branch. Or simply replace `DATABASE_URL` in the `.env.local` during the verification phase.
4. Apply the cleaned schema on this Neon branch (via `pnpm db:push` or the Drizzle migration)
5. Production stays intact during the whole verification phase

### 4c - Test plan to give the user

Provide a test checklist targeted at what was deleted:

```
To verify before merging cleanup/YYYY-MM-DD:

☐ pnpm tsc --noEmit → OK
☐ pnpm lint → OK
☐ pnpm build → OK (no "module not found" warning)
☐ Dev server (pnpm dev) starts without error
☐ Vercel preview: open the URL and click on every main section
☐ Deleted pages: test that they indeed return 404 and not a 500 (and check that no link on the site points to them)
☐ Deleted API routes: if external services call them (Stripe webhooks, Vercel cron, mobile app), test them
☐ Deleted env vars: re-read the Vercel Preview logs looking for "undefined" or "missing"
☐ Deleted DB tables: open Drizzle Studio on the cleanup Neon branch and check that the app works
```

### 4d - Merge

When the user confirms that everything works:

1. PR → merge onto `main` (→ Vercel redeploys to prod)
2. Apply the schema changes on the **Neon main branch** (via `pnpm db:push` pointed at prod)
3. Delete the cleanup Git branch: `git branch -d cleanup/YYYY-MM-DD`
4. Delete the cleanup Neon branch: REST API (`DELETE https://console.neon.tech/api/v2/projects/{id}/branches/{branch_id}`) or `neonctl branches delete cleanup-YYYY-MM-DD`

---

## Golden rules

1. **The report first, the deletions after.** Never a silent deletion.
2. **Certainty + danger on EVERY item.** No "we can clearly see it is safe" category - it is up to the user to decide, with both pieces of info in hand.
3. **Order of presentation: safe first.** The user enters the skill with quick, validated deletions, then tackles the risky things with a clear head.
4. **Everything on a separate branch.** Git AND Neon. Production does not move until the user has tested.
5. **Never `git push --force`** nor `drop table` without double validation.
6. **Always offer the exit door.** After each category: *"Do you want to continue with the next one, or do we stop here?"*

---

## When to refuse the deletion

Even if the user validates, **refuse** and ask for a second confirmation if:

- The item is a DB table with rows (`SELECT COUNT(*) > 0`)
- The item is an API route whose name suggests a webhook (`/api/webhooks/*`, `/api/stripe/*`, `/api/cron/*`)
- The item is an env var whose name matches a pattern known to be read by a dep (`NEXTAUTH_*`, `AUTH_*`, `VERCEL_*`, `NODE_*`, `NEXT_PUBLIC_*`)
- The number of deletions in a 🔴 category exceeds 5 in a single batch

Phrase it: *"You validated N risky elements at once. I prefer that we do them one by one so you have time to review. OK?"*
