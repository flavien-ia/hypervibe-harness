# /start

Prepares your computer so it can build applications with Hypervibe.

## When to use it

This is the **very first command** to run right after installing the plugin. It takes care of installing the necessary tools and connecting to your accounts (GitHub, Vercel, database, etc.). You should only have to run it once.

## How it works

1. **Welcome + detection**: the command checks which system you are using (Windows, Mac, Linux).
2. **Silent audit**: it looks at what is already installed on your machine, without breaking anything.
3. **Automatic installation of the basics**: if Node.js, Git, or pnpm are missing, they are installed on their own (without asking you anything).
4. **Report**: a clear recap shows you what is OK ✅, what is missing ❌, and what is installed but not connected ⚠️.
5. **Cloudflare token**: Hypervibe guides you to generate a token (step by step, 1 minute) that you paste into the chat. It will be saved for good.
6. **CLI connections**: a script opens a dedicated window and has you connect to GitHub, Vercel, and Cloudflare one after another. You follow the on-screen instructions (a browser opens for each connection).
7. **Neon key**: if you connected the Neon database, you generate an API key (another 30 seconds) that the command saves. This activates automatic backups of your future databases.
8. **Final recap + commands**: at the end, you get an overview of the available commands (`/bootstrap`, `/spec`, `/prof`, etc.).
9. **Global rules**: a small rules file (`~/.claude/CLAUDE.md`) is created so that Claude Code follows your conventions across all your projects (no pointless builds, no push without your approval, etc.).

## What it creates for you

- Node.js, pnpm, and Git installed and operational
- GitHub, Vercel, Wrangler (Cloudflare) connected to your accounts
- Cloudflare token and Neon API key saved on your computer. You will never have to retype them
- A global rules file for Claude Code (`~/.claude/CLAUDE.md`)
- A list of the commands you can now use

## Prerequisites

None. This is where it all begins.

{{callout:info|Why all these tools}}
To build complete apps, Hypervibe orchestrates several services: GitHub stores the code, Vercel puts the app online, Neon hosts the database, Resend sends the emails, Cloudflare handles DNS and files. The `/start` command installs and connects all of this **just once**: after that you never think about it again.
{{/callout}}

{{callout:tip|If something goes wrong}}
The script that installs the tools can be interrupted (window closed, connection refused, Ctrl+C). No problem: simply re-run `/start`. The command detects what is already OK and resumes where it left off. No risk of breaking anything.
{{/callout}}
