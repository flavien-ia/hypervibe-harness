# Security

Hypervibe is a set of skills and scripts that an AI agent loads on its own and
runs with your permissions. That is worth being explicit about, because it is a
category with a real attack surface: OWASP published the
[Agentic Skills Top 10](https://owasp.org/www-project-agentic-skills-top-10/)
v1.0 in August 2026, after a campaign that pushed over a thousand malicious
skills reporting to a single command-and-control address.

This page says what this plugin is, what it refuses to do, and how to check that
what you installed is what was published.

## What the plugin is made of

- **Text only, and that is enforced at publication.** Every file is Markdown,
  JavaScript or a template. The publishing pipeline round-trips each file
  through UTF-8 and **refuses the release** if any file is binary, rather than
  shipping something nobody can read.
- **No `package.json`, so no dependencies and no install script.** Nothing is
  fetched or executed when you install the plugin. The scripts use the Node
  standard library and the CLIs you already have (git, pnpm, vercel, wrangler).
- **The plugin never grants itself permissions.** It writes nothing to your
  `settings.json`, and skills run with the tools your session already allows.
  Every shell command they run still goes through the guardrail below.
  Internal helpers additionally narrow their own tool list (`allowed-tools`
  in the front matter).
- **One MCP server, [context7](https://context7.com), over HTTP.** It serves
  library documentation. Nothing is installed locally to reach it, and its
  answers are treated like any other external content (see below).

## Guardrails

Irreversible operations are guarded mechanically, not merely discouraged in
prose. A `PreToolUse` hook refuses a sweeping `git add -A` and destructive SQL,
and asks for your confirmation before a push, a direct production deploy, a
schema push, cloud deletions or a hard reset. The full table is in the README.

Two properties matter here:

- **Fail-open.** The hook runs before every shell command. If it ever fails, it
  lets the command through and says so on stderr: a seatbelt, not an airlock.
- **The scripts carry their own checks.** A hook only sees a command line, so
  `run-sql.mjs` refuses `DROP`/`TRUNCATE` without `--destructif`, and
  `execute-deletions.mjs` requires the project name typed again. Those also
  protect hosts that have no hooks at all, Codex included.

Both directions are tested (`node hooks/test-hooks.mjs`): that a forbidden
command is refused, **and** that a legitimate one goes through. A guardrail that
blocks everything looks exactly like one that works.

## External content is data

Skills fetch documentation, API responses and web pages. All of it is treated as
material to analyse, never as instructions to follow, whoever it claims to come
from. Fetched content never triggers a command, an install, an email, a database
write, or an edit to `CLAUDE.md`, hooks or settings. An MCP server has no
privileged status: it returns third-party content like any other fetch. When an
injection attempt is detected, the rule is to stop and show you the source and
the excerpt, not to handle it silently.

The same applies to what the plugin **generates**. An agent scaffolded by
`/add-agent` reads untrusted content, holds private data and can send things
out, which is precisely the combination indirect prompt injection needs. So:

- it may only email addresses in `AGENT_MAIL_ALLOWLIST` (empty by default: it
  sends nothing until you decide who it may write to);
- it may only POST/PUT to hosts in `AGENT_FETCH_WRITE_HOSTS` (empty by default:
  it reads anything, writes nowhere);
- fetched bodies come back wrapped in a marker drawn at random for that call, so
  the model can tell the frame from the payload, and a page written earlier
  cannot forge the frame.

The allowlists come first and the framing second, on purpose: framing
(*spotlighting*) sharply reduces injection success but does not eliminate it.

## Secrets

Global keys live in a Bitwarden vault, and are typed into an OS window that the
assistant never sees. They are never printed in the chat, never committed, never
written to a file. Project secrets stay in the project's `.env` and in Vercel.
A global git hook (gitleaks, offered at `/start`) blocks any commit containing a
detected secret.

## Verifying what you installed

Each published version has a SHA-256 fingerprint, shown on the download page and
attached to the corresponding GitHub release. `/update-hypervibe` computes the
hash of what it downloaded and **refuses to install** on a mismatch.

Its limit, stated plainly: a fingerprint published by the same site that serves
the file proves the transfer was intact, not that the site is honest. The GitHub
release is the independent channel; compare the two if it matters to you. The
source is public at
[flavien-ia/hypervibe-harness](https://github.com/flavien-ia/hypervibe-harness)
under Apache 2.0.

## Reporting a vulnerability

Write to **flavien@chervet.fr** rather than opening a public issue. Include what
you did, what happened, and the version (`.claude-plugin/plugin.json`). You will
get an answer.
