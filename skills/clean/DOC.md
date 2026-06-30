# /clean

Detects and removes everything that is no longer used in your project to slim it down. Orphan files, dead code, useless dependencies, unused environment variables and DB tables: the validated deletions are applied on a separate branch so that you can verify before merging.

## When to use it

- You want to **slim down** your project after several months of changes
- You want to **identify** what could cause problems (obsolete env vars, DB tables with no caller, etc.)
- You suspect dead code left over from old vibe coding iterations

## How it works

1. **Disclaimer shown at the start**: Hypervibe reminds you that this is a diagnostic. Some findings may be false positives (dynamic imports, references in the database, etc.). **Nothing is deleted without your explicit approval.**

2. **Full audit**: Hypervibe scans your project across several categories:
  - **Orphan files** (files that are imported nowhere)
  - **Dead code** (exports, functions, components never used)
  - **AI leftovers** (stubs, duplicates, TODOs left hanging)
  - **Unused dependencies** (packages in `package.json` but never imported)
  - **Orphan env vars** (declared in `.env` or Vercel but never read on the code side)
  - **DB tables with no caller** (Drizzle tables that are read / written nowhere)
  - **Obsolete migrations** (Drizzle files that are no longer of any use)

3. **Educational report**: for each finding, Hypervibe shows:
  - **Certainty level** (sure / probable / to verify)
  - **Danger level** (no risk / moderate risk / verify carefully first)
  - **Checks done**: Hypervibe has already done all the technical checks (greps, etc.). You see the facts, not a to-do list.
  - **To verify (only you can answer)**: questions about your intentions or external references (newsletter, LinkedIn post, etc.) that Hypervibe cannot know.

4. **You validate what you want to delete**: à la carte. You can accept everything, refuse everything, or sort line by line.

5. **Applied on a separate branch**: Hypervibe creates a `cleanup-<date>` branch, applies the deletions (on the code side **AND** the Neon DB side if applicable), commits, pushes. You test on the Vercel preview.

6. **Merge**: once you are sure nothing is broken, you merge. If something causes a problem, you abandon the branch, nothing is merged into `main`.

## What it creates for you

- A complete project **hygiene report**
- A **`cleanup-*` branch** with the validated deletions (code + DB)
- A clean commit per deletion category
- Nothing is touched until you merge

## Prerequisites

- No particular prerequisite, `/clean` can run on any project of the plugin
- It is better to have a clean Git state (nothing uncommitted) before launching, so as not to mix your work in progress with the deletions

## Tips

{{callout:warning|Always test the preview before merging}}
The `cleanup-*` branch triggers a preview deployment on Vercel. Click the preview link and **really test** your site before merging: every main page, every form, every important user action. A dependency may be loaded dynamically at a particular moment that Hypervibe could not detect statically.
{{/callout}}

{{callout:tip|Easy to undo if there is a problem}}
If you discover that something is broken on the preview after the clean: do not panic. You have not merged, so your `main` is intact. You can either abandon the branch (Git deletion), or ask Hypervibe to undo only the deletion that is causing the problem.
{{/callout}}

{{callout:info|DB = also cleaned}}
If a Drizzle table is no longer used in the code (Hypervibe verifies 0 occurrence of `db.select` / `db.insert` / `db.update` / `db.query` on that table in `src/`), it is proposed for deletion on the DB side. Hypervibe then uses a DROP TABLE on your Neon. This is **destructive** on the DB side, think before validating. A recent Neon backup protects you (if `/add-backup-db` is active, you necessarily have one less than 2 weeks old).
{{/callout}}
