---
name: update-hypervibe
description: Update the Hypervibe plugin to the latest published version. Detects how the plugin was installed - a marketplace install is updated natively by Claude Code (point to the command, change nothing), a manual zip upload in Claude Desktop is updated here (download, verify, swap with a backup). Use when the user says "/update-hypervibe", "update hypervibe", "update the plugin", "mets a jour hypervibe", "is there a new version?", or asks whether their plugin is up to date.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js 18+. No account and no API key: the plugin is open source, the published version is read from the public repository and the archive is downloaded without a token."
---

# Update Hypervibe

Updates **this plugin** to the latest published version.

Hypervibe is installed in one of two ways, and only one of them needs you:

- **Marketplace install** (`/plugin marketplace add flavien-ia/hypervibe-harness`): Claude Code tracks the repository and updates the plugin itself. Replacing files behind its back would put it at odds with its own registry. You point to the native command and stop.
- **Manual upload** (the zip from hypervibe.fr, dropped into Claude Desktop): nobody tells the user a new version came out. That is the case this skill exists for.

The mode is read from Claude Code's own registry, never guessed.

## Progress reporting

The audience may not be technical. Plain sentences, no jargon: "I am checking whether a newer version exists", "I am replacing the plugin files", never "unzip" or "backup directory" without explaining.

## Step 1 - Check

```bash
PLUGIN_DIR="${CLAUDE_SKILL_DIR}/../.."
node "$PLUGIN_DIR/scripts/update/update-hypervibe.mjs" check
```

Read the JSON:

- `offline: true` → *"I cannot reach the update server right now, try again a little later."* **STOP.**
- `mode: "marketplace"` → Claude Code owns the update. Report the versions, then give the command from `commandeNative` and explain it runs in Claude Code, not here. **STOP** (do not download anything).
- `updateAvailable: false` → *"Your plugin is already up to date (version `localVersion`)."* **STOP.**
- `updateAvailable: true` and `mode: "manuel"` → announce: *"A new version is available: `publishedVersion` (you have `localVersion`). Shall I download and install it?"* Wait for the yes.

## Step 2 - Download

```bash
node "$PLUGIN_DIR/scripts/update/update-hypervibe.mjs" download
```

The JSON gives `file` (the archive, in `~/.hypervibe/updates/`), `version`, `files` and `sha256`.

⚠️ **Compare `version` with the `publishedVersion` of Step 1.** The repository announces the release, the site serves it; on the rare occasion the two disagree, the download is the one telling the truth. If they differ, say so plainly and offer to retry later rather than installing something the user did not agree to. **STOP** on any failure, passing on the `message`.

## Step 3 - Install

```bash
node "$PLUGIN_DIR/scripts/update/update-hypervibe.mjs" install --zip "<file from step 2>"
```

The script unpacks the archive to a temporary folder and checks it is a complete plugin **before** touching the installation in place. Only then does it move the current folder aside as a backup and put the new one in its place. If anything fails at any point, the previous version is restored on its own.

- `ok: true` → the JSON gives `version`, `oldVersion` and `backup`. Go to Step 4.
- `ok: false` → nothing was replaced, or the previous version was put back. Report the `message` honestly. **STOP.**

## Step 4 - Wrap up

> **Update installed (version `<version>`)! ✨**
>
> One last thing: **close and reopen Claude Code** so it loads the new version. The previous one is kept as a backup (`hypervibe-backup-<old version>`): once you have confirmed everything works, you can ask me to delete it.

If a `hypervibe-backup-*` folder from an **earlier** update is still lying around and the current plugin works, offer to delete that one too.
