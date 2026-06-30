---
name: add-collab
description: Manage GitHub collaborators on a project that uses the GitHub Actions deploy setup. Lists current collaborators, lets the user add or remove them, and explains how to do it manually. On first use (when the GitHub Actions deploy is not yet configured), it triggers the internal _setup-github-deploy helper to put the deploy infrastructure in place. The goal is to let any GitHub collaborator deploy without paying for a Vercel seat.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Add Collab - Manage GitHub collaborators

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You manage the GitHub collaborators of the current project.

This skill assumes the project is hosted on GitHub and deployed via Vercel. The first time it runs on a new project, it sets up GitHub Actions as the deploy mechanism (via the `_setup-github-deploy` helper). On subsequent runs, it skips straight to collaborator management.

---

## Step 1 - Detect whether GitHub Actions deploy is already configured

Run two checks in parallel:

```bash
# Check 1 - workflow file exists locally
test -f .github/workflows/deploy.yml && echo "workflow:yes" || echo "workflow:no"

# Check 2 - the 3 Vercel secrets exist on GitHub
gh secret list 2>/dev/null | awk '{print $1}'
```

The setup is **complete** only if **all 4 conditions** are true:
- `.github/workflows/deploy.yml` exists locally
- Secret `VERCEL_ORG_ID` is listed
- Secret `VERCEL_PROJECT_ID` is listed
- Secret `VERCEL_TOKEN` is listed

If **any** of these is missing, the setup is incomplete → invoke the **`_setup-github-deploy`** internal skill, wait for it to complete, then continue to Step 2.

If everything is in place, tell the user:
> ✅ Collaborative deployment is already configured on this project. I'll go straight to managing the collaborators.

Then continue to Step 2.

---

## Step 2 - List current collaborators

Get the repo identifier:
```bash
gh repo view --json nameWithOwner -q .nameWithOwner
```

List all collaborators:
```bash
gh api repos/{owner}/{repo}/collaborators -q '.[] | {login, role: .role_name, permission: (if .permissions.admin then "admin" elif .permissions.push then "push" elif .permissions.triage then "triage" else "read" end)}'
```

Replace `{owner}/{repo}` with the value returned above.

Display the list to the user. Format example:
> ## 👥 Current collaborators on repo `{owner}/{repo}`
>
> 1. **you** - admin (owner)
> 2. **alice** - push (can commit, push, open PRs)
> 3. **bob** - triage (can view and triage issues, cannot commit)
>
> _Total: 3 collaborators_

If there's only the owner (you), tell the user:
> ## 👥 Current collaborators
>
> You are the only collaborator on repo `{owner}/{repo}` for now.

---

## Step 3 - Ask what the user wants to do

Tell the user:
> What would you like to do?
>
> - **Add a collaborator** - give me their **GitHub username** (e.g. `alice`).
> - **Remove a collaborator** - give me their **username** or their number in the list above.
> - You can do both in a single sentence, for example: *"Add charlie and remove bob"*.
> - Or reply **nothing** / **skip** to exit without changing anything.
>
> 💡 You can also do everything manually from the GitHub interface at any time:
> - **Add** → GitHub → your repo → **Settings** → **Collaborators and teams** → **Add people** → type the username → choose the role.
> - **Remove** → GitHub → your repo → **Settings** → **Collaborators and teams** → find the person → click **Remove**.

Wait for the user's response.

---

## Step 4 - Process the user's request

Parse the user's natural-language response. Identify each requested action (additions and removals can be combined in one message).

### For each ADD action

```bash
gh api repos/{owner}/{repo}/collaborators/{username} -X PUT -f permission=push
```

`permission=push` is the recommended default - the collaborator can commit, push, open PRs, and trigger the deploy workflow, but **cannot** change repo settings or delete branches.

If the user explicitly asks for another role, accept these values:
- `pull` - read-only (can clone, can't push)
- `triage` - can manage issues/PRs without write access
- `push` - default (can commit and push)
- `maintain` - push + can manage some repo settings (but not destructive)
- `admin` - full control, including deleting the repo (use with caution)

After each successful add, confirm:
> ✅ Invitation sent to **{username}** (role: `push`). They'll receive a GitHub email to accept before they get access to the repo.

If the API call fails (user not found, already a collab, etc.), report the error and continue with the other actions.

### For each REMOVE action

If the user gave a number from the list, resolve it to a username first.

```bash
gh api repos/{owner}/{repo}/collaborators/{username} -X DELETE
```

This is silent on success (HTTP 204). Verify with:
```bash
gh api repos/{owner}/{repo}/collaborators -q '.[].login' | grep -x "{username}" || echo "removed"
```

After each successful remove, confirm:
> ✅ **{username}** has been removed from the collaborators.
>
> ⚠️ Important: they can no longer push or trigger a deploy. **But the deployments they already triggered stay online** - nothing is rolled back automatically. If you want to remove a specific deployment, do it manually from your Vercel dashboard.

If the user tries to remove themselves (the owner), refuse:
> ❌ You can't remove yourself from a repo you own. If you want to transfer ownership, do it from GitHub → Settings → **Transfer ownership**.

---

## Step 5 - Loop or finish

After processing all the user's actions, ask:
> Would you like to do anything else? (add / remove / skip)

If yes → return to Step 2 (re-list to show the updated state).
If no → continue to Step 6.

---

## Step 6 - Final summary

Show the updated collaborator list one last time (re-run Step 2's `gh api` command), then:

> ## ✅ Done
>
> Here's how to manage your collaborators going forward:
>
> - **With me**: just run `/add-collab` again any time.
> - **Manually on GitHub**:
>   - **Add** → Settings → Collaborators and teams → **Add people**
>   - **Remove** → Settings → Collaborators and teams → find the person → **Remove**
>
> All the collaborators you added can now deploy without paying for a Vercel seat: on every push to a branch, GitHub Actions builds a preview; on every push to `main`, GitHub Actions deploys to production.
