---
name: rgpd-audit
description: Audit a Next.js project's RGPD compliance. Scans the code, env vars, and dependencies to detect every third-party data processor (subprocessor) actually used, compares it with the project's privacy policy registry (`src/lib/subprocessors.json`), and reports gaps. Offers to fix the registry, generate the privacy policy page if missing, and link it from the mentions légales. Use when bootstrap was done before the registry-driven privacy policy existed, when refactoring an existing site for RGPD compliance, or to verify nothing has drifted between the code and the legal documentation.
allowed-tools: Bash Read Edit Write Glob Grep
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# /rgpd-audit - Project RGPD audit

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You will audit the project's RGPD compliance: detecting the third-party subprocessors actually used, comparing them with the registry, generating/synchronizing the privacy policy page, and linking it from the legal notices.

Announce each major block clearly.

---

## Step 0 - Preflight

Verify that you are at the root of a Next.js project:

```bash
test -f package.json || test -f apps/web/package.json && echo OK || echo "Not a Next.js project"
```

If the output is not `OK`, tell the user that `/rgpd-audit` must be run from the root of a project and stop.

## Step 1 - Run the audit

Run the bundled script:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/rgpd-audit.mjs"
```

The script returns a JSON object with:
- `webRoot` - root of the code (apps/web for monorepos, root otherwise)
- `registryPath` - path of the registry `src/lib/subprocessors.json`
- `registryExists` - boolean
- `policyPagePath` - path of the policy page if found, otherwise `null`
- `mentionsLegalesPath` - path of the legal notices page if found
- `registryKeys` - keys present in the registry
- `detectedKeys` - keys detected in the code
- `detected` - object `{ key: true }` for each detected subprocessor
- `evidence` - for each detected key, the evidence (package, env var, or source pattern)
- `missing` - keys detected BUT absent from the registry (to add)
- `stale` - keys present in the registry BUT no longer detected (to remove or justify)

Capture the output. You will reason about it in the following Steps.

## Step 2 - Present the report to the user

Present the diagnosis clearly. Format:

> ## 🔍 RGPD audit
>
> **Subprocessors detected in the code (X):**
> - `<key>` - <evidence>
> - …
>
> **State of the `subprocessors.json` registry:**
> - ✅ Present: <count> entries
> - ❌ Absent (never initialized)
>
> **Privacy policy page:**
> - ✅ Found: `<path>`
> - ❌ Missing
>
> **Registry vs code diff:**
> - ❌ Missing from the registry: `<missing keys>` (to add)
> - ⚠️ Stale in the registry: `<stale keys>` (to remove if truly no longer used)
> - ✅ Everything is aligned (if missing.length === 0 && stale.length === 0)

## Step 3 - Propose actions

Ask the user which actions to run, as a menu:

> Would you like to:
> 1. **Synchronize the registry** (add `missing`, remove `stale`)
> 2. **Generate / refresh the page** of the privacy policy
> 3. **Update the legal notices** to point to the privacy policy
> 4. **Do everything** (1 + 2 + 3)
> 5. **Exit** without changing anything

## Step 4 - Synchronize the registry (if requested)

For each key in `missing`, call the `_update-privacy-policy` helper:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --add <key>
```

You can pass several `--add` in a single call.

For each key in `stale`, ask the user **before** removing:
> The subprocessor `brevo` is in the registry but no longer detected in the code. Remove it? (y/N)

If yes:
```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/update-privacy-policy.mjs" --remove <key>
```

If the detected key is not in the helper's catalog (rare - it would mean we invented a new subprocessor), the helper rejects with an error. In that case, alert the user - the catalog must be extended in `scripts/update-privacy-policy.mjs` on the plugin side.

## Step 5 - Generate or refresh the policy page (if requested)

### Case A: `policyPagePath === null` (no page)

Create the page from the template. The template to use depends on the project's i18n state:

- **If `src/i18n/routing.ts` exists** (multilingual project) → use `${CLAUDE_SKILL_DIR}/../../templates/privacy-policy/i18n.tsx`, and then run `node ${CLAUDE_SKILL_DIR}/../../scripts/_i18n-merge-messages.mjs --web-dir <web-root> --feature privacy-policy` to merge the `privacy.*` keys into the `messages/<locale>.json` files.
- **Otherwise** (single-language project) → use `${CLAUDE_SKILL_DIR}/../../templates/privacy-policy/plain.tsx`.

Substitute in the template:
- `{{PROJECT_NAME}}` (read the web-root's `package.json`)
- `{{LAST_UPDATED}}` (today's date, format `YYYY-MM-DD`)

Page location:
- If `src/app/[locale]/` exists → `src/app/[locale]/politique-de-confidentialite/page.tsx`
- Otherwise → `src/app/politique-de-confidentialite/page.tsx`

Create the folder then write the file. Verify that the page does import `~/lib/subprocessors`. If the `~/` alias is not configured in the project (rare), replace it with the appropriate relative path.

### Case B: `policyPagePath !== null` (the page already exists)

Ask the user:
> A privacy policy page already exists at `<path>`. You can:
> 1. **Keep it as is** - the registry is updated but the page is not modified
> 2. **Replace it** with the data-driven template (the current page will be overwritten - useful if the existing page is outdated, hand-written, or out of sync)

If the user chooses 2, make a backup first:
```bash
cp <policyPagePath> <policyPagePath>.backup
```
Then regenerate from the template.

## Step 6 - Update the legal notices (if requested)

If `mentionsLegalesPath !== null`, open the page and verify that it contains a link to `/politique-de-confidentialite`. Otherwise, add a mention in the "Données personnelles et RGPD" section (or create it if absent):

```tsx
<p>
  Pour le détail complet du traitement de vos données et la liste de nos sous-traitants,
  consultez notre <Link href="/politique-de-confidentialite">politique de confidentialité</Link>.
</p>
```

If the user has a very detailed hand-written policy (the Hypervibe case), do **not** touch it in this skill - that is a separate refactor. Mention it in the summary.

## Step 7 - Check UTF-8 (sanity check)

If you touched one or more `.tsx` files, do the global UTF-8 self-check:

```bash
node -e "
  const fs = require('node:fs');
  for (const f of process.argv.slice(1)) {
    const c = fs.readFileSync(f, 'utf8');
    const m = c.match(/\\\\u[0-9a-fA-F]{4}/g);
    if (m) { console.log(f, ':', m.length, 'escapes'); process.exit(1); }
  }
  console.log('UTF-8 OK');
" <files-touched>
```

If Unicode escapes are reported, fix them with the quick recovery script documented in the global CLAUDE.md (section "Règle prioritaire UTF-8").

## Step 8 - Re-run the audit to verify

Re-run the script:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/rgpd-audit.mjs" --pretty
```

Present the output to the user. Everything should be ✅ aligned.

## Step 9 - Final summary

Present a short recap:

> ## ✅ RGPD audit complete
>
> - Registry: <count> documented subprocessors
> - Policy page: `<path>` (created / refreshed / unchanged depending on the case)
> - Legal notices: (updated to point to the policy / already up to date)
>
> **To do manually**:
> - Replace `contact@example.com` in the page with your real contact address
> - Check the legal content of sections 5 (rights) and 6 (cookies) - the template provides standard wording, but your case may require adjustments (minors vs adults, health data, etc.)
> - If you added an unusual subprocessor not covered by the catalog, extend `scripts/update-privacy-policy.mjs` on the Hypervibe plugin side

---

## Notes on special cases

- **Project without any subprocessor** (purely static site): only Vercel will be detected. That is OK - the page must still exist to comply with the LCEN.
- **False positive detected**: if the script reports a subprocessor that is not actually used (for example, `@vercel/analytics` installed but never imported in the layout), inform the user - they can `pnpm remove` the dependency, or you can extract the key from the registry via `--remove`.
- **Out-of-catalog subprocessor**: the `_update-privacy-policy` helper rejects unknown keys. This is intentional, to avoid inventing legal data. If a project uses an exotic service (Mailjet, OVH Object Storage, …), extend the catalog in the plugin's `scripts/update-privacy-policy.mjs` with the correct legal info (legal name, registered office address, legal basis, mechanism for transfers outside the EU where applicable).
