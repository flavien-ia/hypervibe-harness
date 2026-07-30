---
name: save-config
description: Back up the user's Claude Code setup (rules, skills, memory, routines, plugins) to a private GitHub repository they own, plus ZIP snapshots of their conversation history and app state in their cloud folder. Can arm a daily routine. Use for "/save-config", "back up my Claude config", "save my skills and memory".
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js and git; the GitHub push needs the gh CLI, the routine needs Claude Code >= 2.1.81 or the desktop app."
allowed-tools: Bash, Read, Write, Edit, Skill
---

# Save Config - Back up your Claude Code setup

Your configuration is work: rules you wrote, skills you built, memory Claude accumulated about your
projects. It lives in one folder on one machine. This skill puts it somewhere it survives a disk
failure or a reinstall.

Two destinations, on purpose:

| What | Where | Why |
|---|---|---|
| Configuration (CLAUDE.md, skills, commands, scripts, routine prompts, memory, plugins) | a **private GitHub repository** | versioned, diffable, restorable from anywhere |
| Conversation history and desktop app state (left sidebar: recents + pinned), plus a zipped copy of the repo | **ZIP snapshots in a cloud-synced folder** | too big, too binary and too personal for git |

Secrets never go to either one. They belong in the key vault (`/_ensure-vault`).

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Plain language. Never expose script names (*.mjs) - describe what happens in human terms.
- Show progress as a short natural-language checklist.

---

## Step 0 - Read the local settings

```bash
SKILL_SCRIPTS="${CLAUDE_SKILL_DIR}/../../scripts/save-config"
STATE="$HOME/.claude/.hypervibe-save-config.json"
cat "$STATE" 2>/dev/null || echo "{}"
```

The state file holds `{ repo, github, dest, settingsMode }` from the first run. If it exists, use its
values and skip straight to Step 2. If it does not, this is a first run: go to Step 1.

---

## Step 1 - First run only: set it up

**1.a - Where the repository goes.** Default `$HOME/claude-config`. Announce it, do not ask, unless
the user already stated a preference.

**1.b - Check the tools.** `git --version`, `gh --version`, `gh auth status`. If `gh` is missing or
not logged in, say so and offer to continue with a local-only repository (everything works except
the push); do not block the backup on it.

**1.c - Create the repository** with a `.gitignore` that excludes, at minimum:

```
.credentials.json
**/.credentials.json
.env
.env.*
**/.env*
*.pem
*.key
*.p12
*.pfx
id_rsa*
id_ed25519*
**/*service-account*.json
**/*oauth*client*.json
node_modules/
.DS_Store
Thumbs.db
projects/
shell-snapshots/
cache/
debug/
tasks/
telemetry/
sessions/
session-env/
ide/
file-history/
downloads/
backups/
```

**1.d - Create the GitHub repository, private.**

```bash
gh repo create "<github-login>/claude-config" --private --source . --remote origin
```

If a repository with that name already exists and is **public**, stop and tell the user: this
content is not meant to be public. Offer to use another name, or to stay local-only.

**1.e - Save the state file** at `$HOME/.claude/.hypervibe-save-config.json` with `repo`, `github`,
`dest` (leave empty to auto-detect the synced folder) and `settingsMode` (default `redact`, see
Step 3).

---

## Step 2 - Copy the configuration into the repository

```bash
node "$SKILL_SCRIPTS/sync-claude-config.mjs" --repo "<repo>" --settings <mode>
```

Allowlist only: `CLAUDE.md`, `settings.json`, then `skills/`, `commands/`, `scripts/`,
`scheduled-tasks/`, `agents/`, `hooks/`, `rules/`, the plugin manifests, the source of every
installed plugin under 25 MB, and the memory files from `projects/*/memory/`. Transcripts, caches,
credentials and ephemeral state are never copied.

Report the counts the script prints (skills, scripts, routine prompts, memory files, plugins).

---

## Step 3 - The leak gate, before any push

`settings.json` has an `env` block whose values are injected into every session, and people do put
API keys in it. The default `--settings redact` replaces any value longer than 12 characters with
`REDACTED_BY_BACKUP__SET_ME`, so hooks, permissions and plugin state stay restorable without the
secret travelling. `--settings skip` leaves the file out entirely; `--settings keep` copies it
verbatim and should only be used by someone who has checked its contents.

Then scan the working tree and **stop before committing** if you find:

- a private key (`-----BEGIN ... PRIVATE KEY`);
- a complete credential: `sk-`, `sk_live_`, `rk_live_`, `xkeysib-`, `re_`, `ghp_`, `gho_`,
  `github_pat_`, `xoxb-`, `AKIA`, `AIza` followed by a plausible length and charset. A truncated
  mention in documentation (`AIza...`, `sk-...`) is not a leak - do not block on it;
- if the vault is unlocked, the actual **value** of any vault item found in a file. This is the most
  reliable check. Read values through `/_get-secret`; if the vault is locked, skip this check rather
  than opening an unlock window, and say so.

On a hit: report the file and the line, never the value. Fix it or add it to `.gitignore`, then
resume. A global gitleaks hook, if installed, is a second net at commit time, not a reason to skip
this.

---

## Step 4 - Commit and push

Nothing changed? That is a success. Say "nothing changed since the last backup", do not create an
empty commit, and continue to Step 5.

Otherwise commit with a short dated message (`backup: config snapshot (YYYY-MM-DD)`) plus two to
four bullets summarising the diff, then `git push origin main`. If a pre-commit hook blocks on what
looks like a false positive, report it with the file concerned instead of bypassing it silently.

---

## Step 5 - Snapshot the history and the interface

```bash
node "$SKILL_SCRIPTS/snapshot-claude-state.mjs" --repo "<repo>" [--dest "<dest>"]
```

Without `--dest`, the script picks the first cloud-synced folder it finds (Dropbox, OneDrive,
iCloud Drive, Google Drive, Nextcloud, pCloud) and writes to `<folder>/Backups/claude-state/`. If
none exists it falls back to `$HOME/claude-state-backups` and says so - the backup then only
protects against a mistake, not against losing the machine. Offer to set `dest` in the state file.

It writes three things with automatic rotation: `interface/` every run (small: the app stores that
rebuild the left sidebar, plus `~/.claude.json`), `history/` as one baseline plus incrementals
(conversation text; images are replaced by a placeholder to keep the size sane), and `config/` (a
zip of the repository, `.git` included). Files the app has locked are skipped, which is normal.
It also writes a `RESTORE.md` next to them.

---

## Step 6 - Offer the routine (only if it is not already armed)

Check first: list the user's scheduled routines and look for one already doing this. If there is
one, say when it last ran and stop here.

Otherwise ask once:

> Want me to run this on its own, once a day? It takes a few seconds and you never think about it
> again.

If yes, invoke **`_create-routine`** with:
- `GOAL`: "Run the Hypervibe configuration backup: copy ~/.claude into the private config
  repository, check no secret is leaking, commit and push to GitHub, then write the ZIP snapshots of
  the conversation history and the app interface state. If anything fails, say so in the summary."
- `CADENCE`: "every day, in the afternoon" - **daytime on purpose**: the key vault session lasts
  about 12 hours, so a night run would find it locked.
- Preference: **local** (this computer). The routine needs the local `~/.claude` folder, the local
  repository and the cloud-synced folder; a cloud routine cannot see any of them.

The engine handles the honest warnings (it runs on the user's own Claude account and consumes their
subscription) and the creation. Never arm a routine without the user saying yes.

---

## Step 7 - Summary

Give a short summary: what changed in the configuration and the commit that was pushed (or "nothing
changed"), where the snapshots went and how big they are, whether the routine is armed, and any
anomaly (leak found, locked vault, push refused, no synced folder).

The first time, add the one thing they should know:

> Your secrets are in none of this, by design - they come back from your vault. And your routines
> are registered on your Claude account rather than in a file here, so they follow your account
> rather than this machine; their prompts are backed up either way.
