# /save-config

Backs up your Claude Code setup (your rules, your skills, its memory, your plugins) to a private GitHub repository you own, and archives your conversation history to your cloud storage. All of it lives in a single folder, on a single machine, right now. Your keys are never copied: they stay in your vault.

## When to use it

- **Once, early on**: arm the daily backup and stop thinking about it
- **Before tinkering with your setup**: a new global rule, a hook, a big clean-up of your skills
- **After building something you would hate to rebuild**: a custom skill, a routine, rules you refined over weeks
- **Before switching machines** or reinstalling: that is the moment you find out what was not backed up
- **Whenever you want to check** it still runs: run it again, it tells you what changed

## How it works

1. **First time**: Hypervibe creates a **private** Git repository on your GitHub account (`claude-config`), with the guards that keep a secret from landing in it by accident.

2. **Copying your configuration**: only what is useful and non-sensitive, picked one by one: your `CLAUDE.md`, your skills, your commands, your scripts, the missions of your routines, the memory files of each project, and your plugin code. Your conversations, caches and login tokens are never copied.

3. **A check before anything leaves**: before pushing to GitHub, Hypervibe re-reads what is about to go out and looks for API keys, private keys and tokens. If it finds something it stops and names the file, never the value.

4. **Pushing**: a dated commit, pushed to GitHub. If nothing changed since last time, it does not create an empty commit, it just says so.

5. **Archives**: what Git handles poorly goes to ZIP files in your cloud storage (Dropbox, OneDrive, iCloud, Google Drive, Nextcloud, pCloud, detected automatically): your conversation history and the state that rebuilds your left sidebar (recents and pinned).

6. **Automation**: at the end, Hypervibe offers to run all of this once a day, on its own.

## What it creates for you

Two places, with two levels of sensitivity:

```
github.com/<you>/claude-config   (PRIVATE repository)
├── CLAUDE.md                    ← your global rules
├── settings.json                ← your settings (sensitive values masked)
├── skills/  commands/  scripts/ ← what you built
├── scheduled-tasks/             ← the missions of your routines
├── plugins/                     ← your plugins, manifests and code
└── memory/<project>/            ← what Claude remembers about each project

<your cloud>/Backups/claude-state/
├── interface/   ← your left sidebar (recents, pinned), every day
├── history/     ← your conversations, one full baseline then what is new
├── config/      ← the repository zipped, Git history included
└── RESTORE.md   ← the steps for the day you need them
```

## Requirements

- **Git** and a connected **GitHub** account (`gh`). Without GitHub the backup still runs, but it stays on your machine, which protects you from a mistake, not from a dead disk.
- **A cloud-synced folder** for the archives. If there is none, Hypervibe tells you instead of pretending.
- **Node.js**, already there if you use Hypervibe.

## Tips

{{callout:info|Your keys are in none of these backups}}
That is deliberate. Secrets live in your vault, which is already synced and encrypted. A configuration repository, even a private one, is the wrong place for an API key: it gets cloned, shared, made public by mistake. After a reinstall, your keys come back from the vault.
{{/callout}}

{{callout:warning|The settings block that catches everyone}}
Your settings file can hold an `env` block whose values are injected into every session. That is exactly where an API key ends up when a tutorial is followed a bit too fast. Hypervibe masks those values before pushing, so your hooks and permissions stay restorable without the secret travelling.
{{/callout}}

{{callout:tip|Schedule it during the day, not at night}}
The backup needs your vault unlocked to alert you when something breaks, and a vault session lasts about 12 hours. A 3 a.m. run would find it locked. Early afternoon, everything works.
{{/callout}}

{{callout:info|Your routines follow your account, not your machine}}
The schedule of your routines (the time, whether they are on) is registered on your Claude account, not in a file on your disk. After a reinstall and a sign-in, they come back on their own. What is backed up here is their missions, the text describing what they must do. Before recreating one by hand, list the ones that exist, so it does not run twice.
{{/callout}}
