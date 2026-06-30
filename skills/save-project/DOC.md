# /save-project

Creates a **complete backup** of a Hypervibe project as a timestamped zip. Useful before `/delete-project`, before a big refactor, at the end of a mission, or for a personal archive.

## When to use it

- Before running **`/delete-project`** on a project: belt and braces, just in case
- Before a **big refactor**: a clear point to return to if the refactor goes sideways
- At the **end of a mission**: deliver a complete dump to the client, or keep it for yourself as an archive
- **Before a risky experiment**: changing the DB, migrating the stack, reworking auth...
- As a **yearly archive**: a snapshot stored offline, disconnected from the cloud services

## How it goes

1. **Preflight**: Hypervibe detects the project (from the current folder or the argument), verifies that it really is a Hypervibe project (Vercel link, wrangler, git, Next.js), and presents a recap of what will be included.

2. **Questions**:
   - **Include R2?** If you have Cloudflare R2 buckets (uploaded files, images, videos), Hypervibe asks whether you want them in the zip. If there is a lot of content, it can take a while.
   - **Where to save the zip?** By default `Dropbox/Download/`, otherwise the current folder or a path of your choosing.

3. **Execution**: Hypervibe runs in sequence:
   - **Complete git bundle** (the whole history) + uncommitted working changes captured as a patch
   - **Vercel environment variables** (production / preview / development)
   - **Database dump**: schema + one JSON per table
   - **R2 download** (if chosen): all the content of the `<project>` and `<project>-eu` buckets
   - **Claude memory files** for the project
   - **Configs**: `.vercel/project.json`, `wrangler.toml`, `render.yaml`, and Stripe webhook metadata (URLs and events, **without the `whsec_...` secrets**)

4. **Final zip**: everything is compressed into `<project>-snapshot-<TS>.zip` with a `MANIFEST.md` at the root that describes the content and the restoration procedure.

## What it creates for you

A zip with this structure:

```
<project>-snapshot-YYYYMMDD-HHMMSS/
├── MANIFEST.md           ← date, content, restoration procedure
├── code/                 ← git bundle + package.json + working-changes.patch
├── db/                   ← schema.json + one JSON per table
├── env/                  ← production.env + preview.env + development.env
├── storage/              ← R2 (if included)
├── memory/               ← Claude memory files for the project
└── config/               ← Vercel + wrangler + Stripe webhooks metadata
```

## Prerequisites

- The project must have a local folder on the machine (at minimum a `package.json`)
- Vercel CLI and wrangler installed if you want the env-vars and R2 sections (the skill skips the ones that are not available, without crashing)
- Python is used for the final zip (already installed by default on the Hypervibe machine)

## Tips

{{callout:warning|The zip contains plaintext secrets}}
The `env/*.env` files contain your API keys in plaintext (DATABASE_URL, STRIPE_SECRET_KEY, etc.). Treat it as a confidential document: no unencrypted email sharing, no public storage, delete it as soon as it is no longer useful.
{{/callout}}

{{callout:info|No automatic restoration}}
The skill does not offer a `/restore-project`. This is intentional: restoring a complete environment (DB + R2 + Vercel + DNS + webhooks) is a sensitive operation that deserves human eyes at every step. The `MANIFEST.md` inside the zip describes the procedure step by step, and you can always reopen Claude Code in the extracted folder to be guided.
{{/callout}}

{{callout:tip|The safety net before /delete-project}}
The reflex: before permanently deleting a project with `/delete-project`, run `/save-project` first. You have your backup zip, then you can delete with peace of mind.
{{/callout}}

{{callout:warning|R2 can be slow}}
If your buckets contain many large files (videos, high-resolution images), the download can take several minutes or even hours. The skill downloads one object at a time so as not to saturate your connection. If you are in a hurry or do not need the content, choose "skip R2": the snapshot will still include everything else.
{{/callout}}
