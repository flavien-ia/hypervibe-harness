---
name: _setup-github-deploy
description: Internal helper invoked by /add-collab. Sets up GitHub Actions to deploy a Vercel-linked project, replacing Vercel's native Git integration. Configures Vercel token, GitHub secrets, the deploy workflow file, updates CLAUDE.md, and tells the user to suspend Vercel's native integration. Not meant to be invoked directly by users.
user-invocable: false
allowed-tools: Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup GitHub Deploy - Internal helper

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You configure GitHub Actions to deploy a Vercel-linked project so that any GitHub collaborator can trigger deployments without a Vercel account.

This is a one-time setup per project. Once done, `/add-collab` will skip directly to collaborator management.

The caller (`/add-collab`) has already verified that the setup is missing - do not re-check, go straight to Step 1.

---

## Step 1 - Check prerequisites

```bash
gh auth status
vercel whoami
```

Verify the project is linked to Vercel:
```bash
test -f .vercel/project.json && echo "linked" || echo "not linked"
```

If `.vercel/project.json` does not exist, the project must be linked first. Tell the user:
> The project is not linked to Vercel yet. First run `vercel link` or a full `/bootstrap`, then run `/add-collab` again.

Then exit. Otherwise continue.

## Step 2 - Get a Vercel token

Vercel tokens **cannot** be created via CLI - the user must generate one manually.

Tell the user:
> So that GitHub Actions can deploy to Vercel on your behalf, it needs a **Vercel token**.
>
> 1. Go to https://vercel.com/account/tokens
> 2. Click **Create Token**
> 3. Give it a meaningful name (for example: `github-actions-{project-name}`)
> 4. Choose whatever expiration you want (`No expiration` is fine for a personal project)
> 5. Click **Create** and **copy the token immediately** (you will not be able to see it again afterward)
> 6. Paste it here for me
>
> ⚠️ This token will have your Vercel account's permissions. Keep it secret and do not commit it.

**Do not continue until the user has provided the token.**

## Step 3 - Read project info from `.vercel/project.json`

```bash
cat .vercel/project.json
```

Extract `orgId` and `projectId`. They are needed for the workflow.

## Step 4 - Store the 3 secrets in GitHub

```bash
gh secret set VERCEL_ORG_ID --body "<orgId from .vercel/project.json>"
gh secret set VERCEL_PROJECT_ID --body "<projectId from .vercel/project.json>"
gh secret set VERCEL_TOKEN --body "<token provided by user>"
```

Verify all 3 are set:
```bash
gh secret list
```

You should see `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN` listed. If one is missing, re-run the corresponding `gh secret set`.

## Step 5 - Create the workflow file

Create `.github/workflows/deploy.yml`:

```yaml
name: Vercel Deploy

# Why no `vercel pull → build → deploy --prebuilt` pattern:
# `vercel pull` does NOT download env vars marked "Sensitive" on Vercel
# (it's a security feature). If the user marks any required env var as
# Sensitive (highly recommended for secrets - ADMIN_PASSWORD_HASH, AUTH_SECRET,
# API keys), then `vercel build` on the GHA runner crashes because the env
# validator (T3 Zod schema) sees those vars as undefined.
#
# Solution: skip the `pull → build` part and let Vercel do the build itself.
# `vercel deploy [--prod]` without `--prebuilt` uploads the source code, and
# Vercel builds it inside its own infrastructure where Sensitive vars ARE
# injected (same behavior as the native GitHub auto-deploy integration).
#
# Trade-off: build minutes are consumed on Vercel (Hobby = 6000 min/mo, free)
# instead of GHA. Slightly slower (no GHA cache for node_modules) but ~10-30 s
# of difference on T3 projects, negligible. Build logs land in the Vercel
# dashboard, where the user is already going for analytics + env management.
#
# Result: the user can mark any var as Sensitive without breaking the GHA
# deploy - same security posture as Vercel's native integration, while still
# letting GitHub collaborators trigger deploys without paying for Vercel seats.

env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}

on:
  push:
    branches:
      - main
      - '**'

jobs:
  deploy-preview:
    if: github.ref != 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Vercel CLI
        run: npm install -g vercel

      - name: Deploy preview
        id: deploy
        run: |
          url=$(vercel deploy --token=${{ secrets.VERCEL_TOKEN }} --yes)
          echo "url=$url" >> "$GITHUB_OUTPUT"

      - name: Comment deploy URL on commit
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.repos.createCommitComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              commit_sha: context.sha,
              body: `Preview deployment: ${{ steps.deploy.outputs.url }}`
            });

  deploy-production:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Vercel CLI
        run: npm install -g vercel

      - name: Deploy production
        run: vercel deploy --prod --token=${{ secrets.VERCEL_TOKEN }} --yes
```

> **Note:** if the production branch is not `main`, replace `main` with the correct branch name throughout.
>
> **Sensitive vars security**: you can (and you should) mark all your secrets as "Sensitive" on Vercel - `ADMIN_PASSWORD_HASH_*`, `AUTH_SECRET`, `STRIPE_SECRET_KEY`, etc. This workflow is designed to work with sensitive enabled, unlike the usual GHA templates (which use `vercel pull → build → deploy --prebuilt` and break as soon as a var is sensitive).

## Step 6 - Commit and push the workflow

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions deploy for collaborators"
git push
```

Verify the workflow triggers on this push and the deployment succeeds. Wait a few seconds, then check:
```bash
gh run list --workflow=deploy.yml --limit 1
```

If the run is queued or in progress, that's fine - note it but continue. If the run failed immediately (most often a missing secret), investigate and fix before continuing.

## Step 7 - Update CLAUDE.md

Add (or update) a line in the **Stack** section of `CLAUDE.md`:
> Deploy mode: GitHub Actions (collaborator-friendly, no Vercel seats needed)

## Step 8 - Tell the user to suspend Vercel's native integration

This is **the only manual step** the user must do. Without it, every push will trigger TWO deployments (one from Vercel native, one from GitHub Actions), wasting build minutes and causing race conditions.

Tell the user:
> ✅ Deployment via GitHub Actions is in place.
>
> **Manual action required**: you now need to **suspend** Vercel's native integration on GitHub, otherwise you will get two parallel deployments on every push.
>
> 1. Go to **GitHub** → your repo → **Settings** → **Integrations** (or **Applications**)
> 2. Find **Vercel** in the list
> 3. Click **Configure** then **Suspend**
> 4. ⚠️ **Do not uninstall** - just suspend. That way you can revert easily if needed.
>
> Let me know when it's done.

**Wait for the user to confirm** before returning control to the caller.

## Step 9 - Done

Tell the user:
> ✅ GitHub Actions setup complete. You can now manage your collaborators.

Return control to the calling skill (typically `/add-collab`).
