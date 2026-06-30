---
name: _dns-squarespace-manual
description: Internal - guide the user click-by-click to change a Squarespace-registered domain's nameservers manually. Squarespace shut down the Google Domains API after the 2024 acquisition - there is no public API for nameserver changes. Triggered by /add-domain when the registrar is Squarespace (typically a legacy Google Domains user).
user-invocable: false
allowed-tools: Read Edit Write Bash
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# _dns-squarespace-manual - Point a Squarespace domain to Cloudflare (manual)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

You receive as input: `<domain>`, `<ns1_cloudflare>`, `<ns2_cloudflare>`. Your job: guide the user to change the nameservers manually in the Squarespace Domains panel.

## Why there is no automation for Squarespace

Squarespace acquired Google Domains in 2024 and **discontinued the public API** that existed in the Google era. Since then, no programmatic method is available to end users - no REST API, no MCP, no maintained third-party CLI. The only way to manage Squarespace domains is their web dashboard.

→ **Manual mode only**. If the user eventually wants automation, suggest migrating to Cloudflare Registrar / Porkbun / OVH (paid transfer, ~10 euros, but it includes an extra year, so it is effectively free in practice).

## Step 1 - Guide the nameserver change

Show the user:

> Your domain is at **Squarespace** (most likely inherited from **Google Domains**, acquired in 2024). Squarespace discontinued the API - a limitation on their side. Let's do it together:
>
> 1. Sign in at **https://account.squarespace.com/domains** (or via the main Squarespace dashboard → **Domains**)
> 2. Click `<domain>` in the list
> 3. In the left menu: **DNS** → **Domain Nameservers**
> 4. Switch from **"Use Squarespace nameservers"** to **"Use custom nameservers"**
> 5. If you already see nameservers, delete them (trash icon 🗑️)
> 6. Click **ADD NAMESERVER** and add:
>    - `<ns1_cloudflare>`
>    - `<ns2_cloudflare>`
> 7. Click **Save**
> 8. Squarespace will ask for **your Squarespace password** (or your **2FA** if enabled) - enter it to confirm
>
> Let me know when it's done.

Wait for explicit confirmation before handing control back to `add-domain`.

## Step 2 - Note on Squarespace propagation

Squarespace states in its UI *"24-72 hours of propagation"* but in practice it's more like **30 min to 4h** for most TLDs. Don't worry if the DNS check (Step 8 of `add-domain`) takes a while - it may be necessary to wait up to 24h for slower TLDs (notably for domains originating from Google Domains, which are undergoing a registry migration at Squarespace).

## Step 3 - Migration suggestion (optional)

Once confirmed, offer:

> 💡 **Suggestion**: if you want to be able to manage this domain in an automated way later (and save on renewal - Squarespace is expensive), you can **transfer** it to Cloudflare Registrar (free, wholesale pricing), Porkbun (very good pricing), or OVH. The transfer takes 5-7 days and costs ~10 euros, but adds a year to your renewal → effectively free.
>
> No rush, you can do it in 6 months. Should I make a note in the project's `CLAUDE.md` so it isn't forgotten?

If yes → note it in the project's CLAUDE.md via `_update-claude-md`:
- `custom`:
  - heading: `## Future action - migrate the domain away from Squarespace`
  - body: brief description (reason + general procedure)

## Return to add-domain

> ✅ Nameservers for domain `<domain>` pointed to Cloudflare. Propagation: 30 min to 4h in most cases (Squarespace announces up to 72h but that's very pessimistic).
