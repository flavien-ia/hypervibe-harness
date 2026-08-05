# /update-hypervibe

Updates Hypervibe to the latest published version, without leaving your conversation.

## When to use it

{{callout:info|It depends on how you installed Hypervibe}}
If you installed the plugin **with a command** (`/plugin marketplace add flavien-ia/hypervibe-harness`), Claude Code already keeps it up to date on its own. This command will tell you so and hand you the native command rather than doing anything behind its back.
{{/callout}}

- You installed Hypervibe by **uploading the zip** into Claude Desktop, and you want to know whether a newer version is out
- A new version has been announced and you want it without redoing the manual installation
- You simply want to check which version you are running

## How it works

1. **It works out how you installed the plugin.** Claude Code keeps a registry of where each plugin comes from. Hypervibe reads it rather than guessing.

2. **It compares versions.** Your local version against the one published in the public repository. If they match, it stops there and tells you.

3. **It downloads the new version** from hypervibe.fr. No account, no key: the plugin is open source (Apache 2.0).

4. **It checks the archive before touching anything.** The new version is unpacked to a side folder and inspected: is it a genuine complete plugin, is the version the expected one, is nothing trying to write outside its own folder. Your working installation is not touched until those checks pass.

5. **It swaps the folders and keeps a backup.** The old version is set aside as `hypervibe-backup-<version>`. If any step fails, it is put straight back: you never end up without a plugin.

6. **It asks you to restart Claude Code**, which is what actually loads the new version.

## What you get

- The plugin updated in place, at the same path
- The previous version kept as a backup next to it, until you decide to delete it
- The local plugin catalogue kept in step with the new version number

## Good to know

- **The backup is not deleted automatically.** Restart, check that everything works, then ask to have it removed.
- **A failed update costs you nothing**: the previous version is restored on its own, and the command tells you what went wrong.
- **Nothing is sent anywhere.** The check reads a public file, the download is anonymous.
