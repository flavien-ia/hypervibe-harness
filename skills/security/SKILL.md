---
name: security
description: Audit the security of a Next.js/T3 project. Checks for exposed secrets, unprotected routes, input validation, dependency vulnerabilities, headers, CORS, and common web security issues. Use when the user wants to verify their app is safe before going live.
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Security - Security audit

You audit the security of the project and propose concrete fixes. You explain each problem simply, without scaring the user unnecessarily.

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

**Disclaimer to display at the start of the audit:**

> ⚠️ **Important**: this audit covers common security flaws and frequent mistakes. It does not replace a professional security audit. If your app handles sensitive data (health, banking, critical personal data), have it validated by a security expert.

---

## Teaching rule (important)

The report must be **readable by someone who is not a developer**. The user is often someone who has just put their app online and wants to understand what they are risking, not a security specialist.

**Concrete rules:**

- When you use a technical term, explain it immediately in parentheses the first time it appears. Examples:
  - *"XSS (an attack where someone manages to inject malicious code into a page that other people visit)"*
  - *"CSRF (making a logged-in user perform an action without realizing it, via a booby-trapped link)"*
  - *"Rate limiting (limiting the number of requests a single person can make in a short time, to prevent abuse or brute-force attacks)"*
  - *"Hashing (an irreversible transformation of a password into an unreadable string, so that even you cannot read it in your database)"*
- Whenever you can, prefer a plain wording and put the technical term in parentheses. Example: *"Your admin password is written in plain text in the code (meaning it is visible to the naked eye if someone has access to the project)"* rather than *"plaintext password in source"*.
- Use everyday analogies for abstract concepts: an API secret = "an apartment key", a security header = "an instruction posted at the door", a SQL injection = "someone slipping a fake order into your till by pretending to be a customer".
- **Explain the concrete consequence** of each flaw, not just its technical name. Examples:
  - Bad: *"Missing CSP header"*
  - Good: *"A security header is missing that tells the browser 'only run code that comes from me'. Consequence: if someone manages to inject a piece of code into one of your pages, the browser will run it without question."*
- For the proposed fixes, explain **why** we make the fix, not just the code diff.
- Never be condescending or alarmist. The user is intelligent, they just don't know this field, and fear does not help in making the right decisions.

This rule applies to the report (step 2) and to the fix proposals (step 3). In your internal scan (step 1), you can stay brief and technical.

---

## Progress communication

At startup, display a checklist in natural language. During execution, announce with `↳ …` then mark `✅`. **Never** "Step N" internally in your user-facing messages. **Never** the internal skill names prefixed with `_`, describe them in plain language.

---


## Step 1 - Audit

Analyze the project and check each point. For each point, indicate:
- ✅ OK
- ⚠️ To improve (moderate risk)
- 🔴 Critical (fix immediately)

### 1a - Secrets and environment variables

- **Secrets in the source code**: search for API keys, tokens, passwords hardcoded in the `.ts`, `.tsx`, `.js` files. Look for patterns: `sk_live_`, `re_`, `whsec_`, `ghp_`, `Bearer `, `password`, `secret`, `apiKey` followed by a hardcoded value.
- **.env file present and complete**: verify that secrets are in `.env` and not in the code.
- **.gitignore file**: verify it contains `.env`, `.env.local`, `.env.production`, `node_modules/`, `.next/`.
- **.env file committed to Git**: check with `git log --all --diff-filter=A -- .env .env.local .env.production` whether a .env file has ever been committed (even if it was deleted afterward, the secrets are in the history).
- **Client-side variables**: verify that only variables prefixed with `NEXT_PUBLIC_` are accessible client-side. Secrets (API keys, tokens) must NEVER have this prefix.

### 1b - Authentication and authorization

- **Protected API routes**: verify that all sensitive tRPC routes have an authentication check (`protectedProcedure` or manual session verification).
- **Protected page routes**: verify that admin/dashboard pages have a session check.
- **Hashed passwords**: if the app uses credentials, verify that passwords are hashed (scrypt, bcrypt, argon2) and never stored in plain text.
- **Session and cookies**: verify that session cookies have the `httpOnly`, `secure`, `sameSite` flags.
- **Roles and permissions**: if the app has roles (admin, user), verify that the checks are server-side (not only client-side).

### 1c - Input validation

- **Forms**: verify that form data is validated server-side (via Zod in tRPC, not only client-side).
- **URL parameters**: verify that dynamic parameters (e.g. `[id]`) are validated and typed before being used in DB queries.
- **File uploads**: if the app accepts uploads, verify MIME type validation, max size, and that files are not served directly from the filesystem.
- **Search and filters**: verify that search fields do not allow injection (SQL or NoSQL).

### 1d - SQL injection and DB queries

- **Parameterized queries**: verify that Drizzle ORM is used for all queries (no `sql` template literals with unescaped variables).
- **Raw SQL**: look for occurrences of `sql```, `db.execute`, `$queryRaw` and verify that user variables are passed via parameters, not by concatenation.

### 1e - Security headers

Check in `next.config.js` or the middleware whether the following headers are configured:

- **Strict-Transport-Security** (HSTS): forces HTTPS
- **X-Content-Type-Options: nosniff**: prevents MIME sniffing
- **X-Frame-Options: DENY** or **SAMEORIGIN**: protection against clickjacking
- **X-XSS-Protection: 1; mode=block**: basic XSS protection
- **Referrer-Policy: strict-origin-when-cross-origin**: controls the info sent to the referrer
- **Content-Security-Policy**: controls the allowed script/style sources (at minimum, check whether a CSP exists)

### 1f - CORS (Cross-Origin Resource Sharing)

- Check whether CORS headers are configured in the API routes or the middleware.
- If so, verify that `Access-Control-Allow-Origin` is not `*` in production (too permissive).
- If the app has a public API, verify that only the authorized domains are listed.

### 1g - Dependencies

Use `npm audit` with a temporary lockfile rather than `pnpm audit` (pnpm 10 always hits the old deprecated endpoint `/audits/quick` → HTTP 410):

```bash
npm install --package-lock-only --silent 2>&1
npm audit --omit=dev --json 2>&1
rm -f package-lock.json
```

- Parse the returned JSON, flag the critical and high vulnerabilities in prod (devDeps already excluded by `--omit=dev`).
- Propose `pnpm update <pkg>@<safe-version>` for each vulnerable package (read `fixAvailable.version` in the JSON output).

### 1h - Rate limiting and abuse protection

- **Public API routes**: check whether rate limiting is in place (via middleware or a service like Vercel Edge).
- **Forms**: check for the presence of anti-spam protection (honeypot, rate limiting, or captcha).
- **Authentication**: check for protection against brute force (rate limit on login, delay after X attempts).

### 1i - Data exposure

- **API responses**: verify that endpoints do not return more data than necessary (e.g. do not return the password hash in a user object).
- **Errors**: verify that error messages in production do not reveal stack traces, file paths, or technical information.
- **Console.log**: look for `console.log` statements that could expose sensitive data in production.

### 1j - Next.js configuration

- **Production mode**: verify that `next.config.js` does not disable protections (e.g. `poweredBy` should be false, `reactStrictMode` should be true).
- **Rewrites and redirects**: verify that no redirect points to an uncontrolled external domain.
- **Error pages**: verify that custom error pages do not reveal technical information.

---

## Step 2 - Report

Present the report:

> **Security audit - Results**
>
> 🔴 **Critical (X points)** - fix immediately:
> - (list of critical problems with a simple explanation)
>
> ⚠️ **To improve (X points)**:
> - (list with explanation)
>
> ✅ **OK (X points)**: (condensed list)
>
> **Score: X/Y**
>
> ⚠️ Reminder: this audit covers common flaws. For sensitive data or a critical project, consult a security professional.

---

## Step 3 - Fixes

Ask the user:

> Do you want me to fix the 🔴 critical problems now?

If yes, fix in this order of priority:
1. **Exposed secrets** → move them into `.env`, check `.gitignore`. If a `.env` was committed in the past, remove it from the git history and **regenerate all the affected keys** (the history remains accessible).
2. **Unprotected routes** → add the auth checks (`protectedProcedure` or session check).
3. **Missing input validation** → add the server-side Zod schemas.
4. **Missing security headers** → run `node "${CLAUDE_SKILL_DIR}/../../scripts/setup-security.mjs"` (idempotent: applies headers + console.log isDev guard + rate-limit.ts + rateLimitedProcedure if not already in place).
5. **Vulnerable dependencies** → parse the JSON output of `npm audit --omit=dev` (generated in 1g) to identify the affected packages, then `pnpm update <pkg>@<safe-version>` for each. `pnpm audit --fix` also depends on the old deprecated endpoint, do not rely on it.
6. **Remaining problems** identified in the audit.

---

## Step 4 - Verification

After the fixes, quickly re-run the checks on the points that were 🔴 or ⚠️ and display the new score.

> ✅ **Audit complete.** Score: X/Y → X/Y
>
> Reminder: if your app handles sensitive data, have it audited by a professional before going to production.
