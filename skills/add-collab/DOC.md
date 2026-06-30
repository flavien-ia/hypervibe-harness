# /add-collab

Invite or remove collaborators on your project without paying for one Vercel seat per person. Everything goes through GitHub and an automatic deployment system wired in as a replacement for the native Vercel integration.

## When to use it

- You want to **invite a developer** to work on your project without paying for an extra Vercel license
- You want to **remove a collaborator** (an employee leaving, end of an engagement, etc.)
- You just want to see your current list of collaborators

## How it works

1. **Setup detection**: the first time you run `/add-collab` on a project, Hypervibe detects that the **GitHub Actions** deployment chain is not yet configured. It sets it up automatically:
  - A Vercel token is generated (1 action in the Vercel dashboard, Hypervibe guides you through it)
  - The necessary secrets are pushed to GitHub
  - A workflow file is created so that every `git push` to `main` redeploys to production, and every other branch generates a preview deployment
  - **One last setting on the Vercel side for you to do yourself**: pause the native Vercel integration on GitHub to avoid having two deployments running in parallel on every push. Hypervibe gives you the exact clicks.

   This setup happens only **once per project**: on subsequent runs, Hypervibe jumps straight to collaborator management.

2. **Current list**: Hypervibe displays the existing collaborators with their role (admin / push / triage / read).

3. **Your actions**: you say in plain language what you want to do:
  - *"Add alice"*, an invitation is sent to the GitHub user `alice` with the default `push` role
  - *"Remove bob"*, bob is removed from the collaborators immediately
  - *"Add charlie and remove dave"*, multiple actions in a single sentence
  - *"Add eve as admin"*, a specific role (you can also ask for `pull`, `triage`, `push`, `maintain`)

4. **Verification + recap**: Hypervibe re-lists the collaborators after each action so you can see the up-to-date state.

## What it creates for you

- On the first run: the complete **GitHub Actions chain** (workflow + secrets) that lets you deploy without Vercel seats
- Over time: **invitations sent** to collaborators (they receive a GitHub email to accept)
- **Immediate removals** when you remove someone

## Prerequisites

- The project must be a **GitHub repo** linked to a **Vercel project** (typically after `/bootstrap`)
- You must be the owner (or have admin rights) on the repo

## Tips

{{callout:tip|Why GitHub Actions rather than native Vercel}}
By default, Vercel deploys via its native GitHub integration, but every GitHub collaborator who wants to view / trigger deployments must have a **paid Vercel seat** (~$20/month/person). By switching to GitHub Actions, **any GitHub collaborator** can trigger a deployment just by pushing, with no extra Vercel seat to pay for. You keep your single Vercel account as owner.
{{/callout}}

{{callout:warning|One push = one deploy}}
Once the chain is in place, **any push** to `main` (by any authorized collaborator) triggers a production deployment. Pushes to other branches create preview deployments. If you want to block that for some contributors, use GitHub's branch protection rules (require PR review before merging to main).
{{/callout}}

{{callout:info|Removing a collaborator does not roll back their deployments}}
When you remove someone, **the deployments they already made stay online**: nothing is undone automatically. If you want to remove a specific deployment, do it manually from your Vercel dashboard.
{{/callout}}
