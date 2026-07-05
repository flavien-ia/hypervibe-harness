# Hypervibe

> 🇫🇷 [Lire en français](README.fr.md)

A Claude Code plugin that bootstraps full-stack T3 projects with modular addons. Built for non-technical users who want to create and deploy web apps by describing what they want in plain language.

> 📘 **First time? Follow the [step-by-step installation guide](https://hypervibe.fr/plugin/installation).** It walks you through the prerequisites, the accounts to create, and your first project, end to end.

## Installation

You need [Claude Code](https://claude.com/claude-code) first. It is included with a **Claude Pro** plan or higher (the free plan is not enough), and ships with the Claude desktop app (Mac and Windows) or as a CLI. New to Claude? [Create your account and subscribe here](https://claude.ai/referral/BtZlSHizAA). Then, inside Claude Code, run:

```
/plugin marketplace add flavien-ia/hypervibe-harness
/plugin install hypervibe@hypervibe-harness
```

Updating from a version older than 2.5? After updating the plugin, just re-run `/start` in Claude Code: it detects your old background mechanisms and consolidates them into the new unified one for you, safely and with your consent at each step (nothing happens if you have nothing to migrate). More context in [MIGRATION.md](MIGRATION.md).

Then type `/start`: it installs everything else for you (Node.js, pnpm, Git, and each service's CLI) and checks that all your connections work.

Prefer a guided, click-by-click version? See the full walkthrough at **[hypervibe.fr/plugin/installation](https://hypervibe.fr/plugin/installation)**.

## Getting started

| New to this? | Already comfortable? |
|---|---|
| `/start` - checks your setup and shows you around | `/bootstrap` - jump straight in |
| `/prof` - explains how everything works | `/spec` - build a detailed spec first |

## How it works

Just describe what you want to build. Claude analyzes your description and infers which addons are needed (database, auth, payments, etc.), then presents the plan for your approval before building.

```
/bootstrap My photographer portfolio website
/bootstrap My lead management dashboard with user accounts
/bootstrap My online invoicing SaaS with Stripe payments
```

### Three ways to define your project

When you launch `/bootstrap`, you choose how to describe your app:

- **A - Build a spec together** (`/spec`): Claude guides you step by step through 5 blocks (project, pages, design, features, constraints) and produces a `cahier-des-charges.md`
- **B - Provide an existing spec**: give Claude a `.md` file, he reads it and infers the infrastructure
- **C - Short description only**: Claude asks the infrastructure questions in one go and builds a simple app

## All skills

### Workflow skills

| Skill | What it does |
|---|---|
| `/bootstrap` | Create a new project from scratch |
| `/spec` | Build a detailed project specification, step by step |
| `/start` | First-time onboarding: checks prerequisites, presents all commands |
| `/prof` | Explains how everything works in plain language (pedagogical mode) |
| `/seo` | Audit SEO and fix issues (metadata, sitemap, OG, structure, URLs/slugs, accessibility, readability, topical depth, freshness) |
| `/geo` | Audit and optimize for AI answer engines (ChatGPT, Claude, Perplexity, Google AI Overviews) - llms.txt, AI crawler policy, FAQPage schema, citability signals, E-E-A-T, Q&A format. Complementary to `/seo`. |
| `/gsc` | Connect the site to Google Search Console, verify DNS automatically, submit the sitemap, then audit what Google actually sees - indexing coverage, top queries, quick wins (positions 11-20), low CTR pages, zombie pages. Complementary to `/seo` (external Google data). |
| `/security` | Security audit (secrets, auth, headers, dependencies, RGPD) |
| `/rgpd-audit` | RGPD compliance audit - detects third-party services in use, updates the subprocessors registry, generates or refreshes the privacy policy page |
| `/clean` | Find unused files, dead code, orphan env vars and DB tables - review + delete on a branch |
| `/rotate-secret` | Rotate a secret (Stripe, Brevo, Google…) everywhere it lives - local + Vercel |
| `/quotas` | Show your current usage against each service's free tier (Neon, Cloudflare, Brevo, Resend, Vercel) with verdicts per gauge |

### Addon skills

Each addon can be activated during `/bootstrap` or used standalone on an existing project.

| Skill | What it adds |
|---|---|
| `/add-db` | Neon PostgreSQL + Drizzle ORM (DB provisioned in Frankfurt, `aws-eu-central-1`) |
| `/add-auth` | NextAuth v5 - admin-only interface OR user accounts (email+password with signup, account, delete, and optional forgot-password if email is configured). Google/GitHub OAuth offered as optional add-ons in users mode. |
| `/add-google-auth` | Add Google OAuth login (extends `/add-auth`) |
| `/add-github-auth` | Add GitHub OAuth login (extends `/add-auth`) |
| `/add-email` | Resend or Brevo transactional emails (auto-detected) |
| `/add-stripe` | Stripe Checkout payments |
| `/add-i18n` | next-intl internationalization |
| `/add-storage` | Cloudflare R2 file storage |
| `/add-analytics` | Google Analytics (GA4) with RGPD cookie consent |
| `/add-map` | Interactive vector map (MapLibre + OpenFreeMap - free, no API key, EU). Single pin, multi-pin, route, or map-first layouts |
| `/add-dark-mode` | Dark mode (light / dark / system) with a ready-to-use toggle |
| `/add-domain` | Connect a custom domain name (guided setup) |
| `/new-email-address` | Create a receiving address (`contact@yourdomain.com`) forwarded to your inbox (Cloudflare Email Routing) |
| `/add-cron` | Scheduled task - Cloudflare Worker (precise) or GitHub Action (best-effort), chosen based on what the cron does |
| `/add-automation` | Background processing - routes to cron, Cloudflare Worker, or Render Background Worker depending on the need. Hands off to `/add-agent` when you describe an AI agent. |
| `/add-agent` | Autonomous AI agent (Anthropic Claude + tools + optional semantic memory + budget circuit breaker + full persistence) deployed on Render |
| `/add-agent-dashboard` | Monitoring dashboard for agents under `/admin/agents` (cost, runs, turn-by-turn detail, run-now button) |
| `/add-collab` | Add GitHub collaborators that can deploy (via GitHub Actions, without paying a Vercel seat) |
| `/add-backup-db` | Automated Neon DB backups (shared Cloudflare Worker, rolling + aging snapshots) |

To use an addon standalone, simply ask Claude Code:
> "Add authentication to my project" → uses add-auth
> "Set up Stripe for payments" → uses add-stripe
> "I want to connect my domain name" → uses add-domain

### Internal helpers

The plugin also ships with `_`-prefixed internal skills that are invoked automatically by the public skills above (never by the user directly). They handle shared concerns like env var pushing (`_push-env-vars`), dependency detection (`_check-deps`), secret generation, password hashing, auth setup sub-branches, CLI auto-install, etc. You never need to invoke them yourself.

## Stack

Projects bootstrapped with this plugin use:

- **Next.js** (App Router) with TypeScript
- **tRPC** for type-safe API routes
- **Drizzle ORM** for database access
- **Tailwind CSS** for styling
- **shadcn/ui** for UI components
- **Inter** as the default font (via next/font)
- **GitHub** for source control
- **Vercel** for hosting and deployment (functions pinned to `fra1` - Frankfurt)
- **Neon** for PostgreSQL database (provisioned in Frankfurt, `aws-eu-central-1` - when DB addon is used)
- **Resend or Brevo** for transactional emails (when the email addon is used)
- **Stripe** for payments (when stripe addon is used)
- **Cloudflare R2** for file storage (when storage addon is used)
- **Google Analytics** for analytics (when analytics addon is used)
- **next-intl** for internationalization (when i18n addon is used)
- **Anthropic** (Claude API) for autonomous AI agents (when the agent addon is used)
- **Render** for hosting AI agents and long-running automations (when the agent / automation addon routes to Render)
- **Bitwarden** as a **key vault** - your cross-project access keys (Cloudflare, Neon, email…) are stored **encrypted** in a vault, never in plaintext on disk or in environment variables. `/start` sets it up (free account, EU region); you type one master password once a day and Claude fetches the keys on its own when needed.

## What the bootstrap sets up automatically

Every project gets, regardless of mode:

- T3 scaffold (Next.js + TypeScript + Tailwind + tRPC)
- shadcn/ui component library
- Base SEO (metadata, robots.txt, sitemap.ts, OG placeholder, semantic HTML)
- GitHub private repo
- Vercel deployment **with functions pinned to `fra1` (Frankfurt)** - better latency for EU visitors, data stays in EU
- Custom 404 page
- Mentions légales + **data-driven privacy policy page**: powered by a central subprocessors registry (`src/lib/subprocessors.json`) that auto-updates whenever you add a service via `/add-*` skills
- CLAUDE.md with all project conventions

## Conventions (written to CLAUDE.md)

The generated CLAUDE.md includes these conventions that Claude Code follows on every subsequent interaction:

- **Design**: read `globals.css` before creating components, use CSS variables, never use default Tailwind colors
- **Font**: Inter by default (unless the user specifies otherwise)
- **UX**: `cursor-pointer` on all clickable elements
- **Feedback**: use shadcn/ui `toast`/`sonner` for success/error messages, never `alert()`
- **Images**: always use `<Image>` from next/image with descriptive `alt` attributes
- **Responsive**: mobile-first, all components must work on mobile (< 640px) and desktop
- **Optimistic UI** (if DB): update the interface immediately, sync the database in the background
- **Git**: never push without explicit user request
- **Workflow**: for complex tasks (3+ files), create a numbered todo list with ✅/⏳ progress
- **Components**: always use shadcn/ui before building custom components
- **TypeScript**: never use `any`, type everything properly
- **Typography**: never use em dashes ( - ) in user-facing text

## Included MCP server

The plugin ships with [Context7](https://github.com/upstash/context7-mcp), which gives Claude Code access to up-to-date documentation for Next.js, Tailwind, Drizzle, and other technologies.

## Author

**Flavien Chervet** - [flavienchervet.fr](https://flavienchervet.fr)

## License

Licensed under the [Apache License 2.0](LICENSE). The source code is free to use, modify and redistribute under the terms of that license.

### Trademark

**Hypervibe** and **Certifié Hypervibe** are trademarks of Hyper Wisdom. The open-source license covers the code, not the name: it grants no right to use these names (see section 6 of the Apache License). You may not name a fork, derivative, product or service "Hypervibe", nor imply an official affiliation or certification, without written permission.
