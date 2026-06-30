---
name: _setup-2fa-users
description: Internal. Sets up optional per-user 2FA (TOTP) on a hypervibe user-accounts auth. Each user enables 2FA from their account page (scan a QR, confirm a code), with the secret + one-off backup codes stored per-user in the database. Login asks for the code after the password only for users who enabled it. Invoked by /add-2fa when the project is in users mode. Claude-piloted (no script) because the account page and signin flow are project-specific. Not meant to be invoked directly by users.
argument-hint: ""
compatibility: "Agent Skills standard (Claude Code or Codex). Requires Node.js; most workflows also use pnpm, git, and project CLIs (vercel, gh)."
---

# Setup 2FA - Users mode (optional per user, in DB)

## Communication
- Detect the user's language from their messages and ALWAYS reply in that language (default: English). This applies to every user-facing message: questions, progress, confirmations, summaries, errors.
- Use plain, non-technical business language. Never expose internal script names (*.mjs) or jargon; describe actions in human terms.
- When generating user-facing content for the scaffolded project (UI labels, emails, copy), write it in the user's language too.
- Show progress as a short natural-language checklist (in-progress and done states).

Sets up **optional per-user** 2FA on a Hypervibe accounts-based auth. No deterministic script: the Account page and the login flow vary from one project to another, so Claude implements it contextually by following this guide. **Check the build (`pnpm tsc --noEmit` + `pnpm lint`) after each large block.**

**Input variables** (passed by `add-2fa`): `PROJECT_NAME`, `WEB_DIR`, `AUTH_APP`.

> ⚠️ **Sensitive auth flow + project-specific.** Implement block by block, check the build between each one, and test the login (enable 2FA → log out → log back in with a code) before concluding.

---

## Step 1 - Prerequisites (DB + user auth)

- `_check-deps db` → if `db_ok=false`, point to `/add-db` then stop.
- Confirm that `src/server/auth.ts` contains the `users` marker and that the `users` table exists (schema). Otherwise stop (the target is the accounts-based auth).
- Install the libs: `cd <WEB_DIR> && pnpm add otpauth qrcode`.

---

## Step 2 - Schema: per-user 2FA tables

Add to `src/server/db/schema.ts` (making sure `text, boolean, timestamp, serial` are imported from `drizzle-orm/pg-core`):

```ts
/** Per-user 2FA (TOTP). */
export const userTwoFactor = createTable("user_two_factor", {
  userId: text("user_id").primaryKey(),
  secret: text("secret").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export const userBackupCode = createTable("user_backup_code", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});
```

Then `cd <WEB_DIR> && pnpm db:push`.

---

## Step 3 - TOTP helpers + DB access

**`src/lib/totp.ts`** (generic, the secret is passed as an argument because it is per-user):

```ts
import { TOTP, Secret } from "otpauth";
import { randomBytes } from "crypto";

export function generateTotpSecret(): string { return new Secret({ size: 20 }).base32; }
export function totpUrl(issuer: string, account: string, secret: string): string {
  return new TOTP({ issuer, label: account, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) }).toString();
}
export function verifyTotp(secret: string, token: string): boolean {
  const clean = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return new TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) }).validate({ token: clean, window: 1 }) !== null;
}
export function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () => {
    const h = randomBytes(4).toString("hex").toUpperCase();
    return `${h.slice(0, 4)}-${h.slice(4, 8)}`;
  });
}
```

**`src/lib/user-2fa.ts`** (DB; reuses `hashPassword`/`verifyPassword` from `~/lib/password`):

```ts
import { eq, and, isNull } from "drizzle-orm";
import { db } from "~/server/db";
import { userTwoFactor, userBackupCode } from "~/server/db/schema";
import { hashPassword, verifyPassword } from "~/lib/password";

export async function getUser2fa(userId: string) {
  return (await db.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId)).limit(1))[0] ?? null;
}
export async function isTwoFactorEnabled(userId: string) {
  return (await getUser2fa(userId))?.enabled ?? false;
}
export async function setPendingSecret(userId: string, secret: string) {
  const existing = await getUser2fa(userId);
  if (existing) await db.update(userTwoFactor).set({ secret, enabled: false }).where(eq(userTwoFactor.userId, userId));
  else await db.insert(userTwoFactor).values({ userId, secret, enabled: false });
}
export async function enableTwoFactor(userId: string) {
  await db.update(userTwoFactor).set({ enabled: true }).where(eq(userTwoFactor.userId, userId));
}
export async function disableTwoFactor(userId: string) {
  await db.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
  await db.delete(userBackupCode).where(eq(userBackupCode.userId, userId));
}
export async function replaceBackupCodes(userId: string, codes: string[]) {
  await db.delete(userBackupCode).where(eq(userBackupCode.userId, userId));
  for (const c of codes) await db.insert(userBackupCode).values({ userId, codeHash: await hashPassword(c.toUpperCase()) });
}
export async function consumeUserBackupCode(userId: string, code: string) {
  const norm = code.trim().toUpperCase();
  const rows = await db.select().from(userBackupCode).where(and(eq(userBackupCode.userId, userId), isNull(userBackupCode.usedAt)));
  for (const r of rows) if (await verifyPassword(norm, r.codeHash)) {
    await db.update(userBackupCode).set({ usedAt: new Date() }).where(eq(userBackupCode.id, r.id));
    return true;
  }
  return false;
}
```

---

## Step 4 - Enrollment server actions (`src/app/account/two-factor-actions.ts`)

Generate the secret on the server, return the **QR (SVG)** so it can be displayed in the browser (never the chat). Replace `<ISSUER>` with the project name.

```ts
"use server";
import QRCode from "qrcode";
import { auth } from "~/server/auth";
import { generateTotpSecret, totpUrl, verifyTotp, generateBackupCodes } from "~/lib/totp";
import { getUser2fa, setPendingSecret, enableTwoFactor, disableTwoFactor, replaceBackupCodes, isTwoFactorEnabled } from "~/lib/user-2fa";

const ISSUER = "<ISSUER>";

export async function start2faSetup() {
  const s = await auth(); const userId = s?.user?.id;
  if (!userId) return { error: "unauthorized" as const };
  if (await isTwoFactorEnabled(userId)) return { error: "already_enabled" as const };
  const secret = generateTotpSecret();
  await setPendingSecret(userId, secret);
  const url = totpUrl(ISSUER, s.user.email ?? "account", secret);
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 2, width: 200 });
  return { secret, qrSvg };
}
export async function confirm2faSetup(code: string) {
  const s = await auth(); const userId = s?.user?.id;
  if (!userId) return { error: "unauthorized" as const };
  const row = await getUser2fa(userId);
  if (!row) return { error: "no_setup" as const };
  if (!verifyTotp(row.secret, code)) return { error: "invalid_code" as const };
  await enableTwoFactor(userId);
  const backupCodes = generateBackupCodes();
  await replaceBackupCodes(userId, backupCodes);
  return { enabled: true as const, backupCodes };
}
export async function disable2fa() {
  const s = await auth(); const userId = s?.user?.id;
  if (!userId) return { error: "unauthorized" as const };
  await disableTwoFactor(userId); return { disabled: true as const };
}
export async function regenerateBackupCodes() {
  const s = await auth(); const userId = s?.user?.id;
  if (!userId || !(await isTwoFactorEnabled(userId))) return { error: "not_enabled" as const };
  const backupCodes = generateBackupCodes();
  await replaceBackupCodes(userId, backupCodes);
  return { backupCodes };
}
```

> Check that the session exposes `user.id` (the Hypervibe user auth does). If it exposes an `email` but no `id`, adapt the helpers so the key = email.

---

## Step 5 - 2FA section in the Account page

Create a client component `src/app/account/two-factor-section.tsx` ("Security - Two-factor authentication") with 3 states:
1. **Disabled**: an "Enable" button. On click → `start2faSetup()` → display the **QR (`qrSvg`)** + the key + a "6-digit code" field + a "Confirm" button → `confirm2faSetup(code)`.
2. **Confirmation OK**: display the 8 backup codes **only once** (in the browser) with "write them down now".
3. **Enabled**: an "enabled" badge + "Disable" (`disable2fa`) and "Regenerate codes" (`regenerateBackupCodes`) buttons.

Style: reuse the project's shadcn/ui components (Card, Button, Input, toast). Import the section into `src/app/account/page.tsx` (pass the component the initial state `isTwoFactorEnabled(userId)` computed server-side in the page).

---

## Step 6 - 2FA step at login (the sensitive point)

The users flow logs in via `signIn("credentials", …)`. Add a 2FA step **only for accounts that enabled it**. Recommended approach (mirror of admin mode):

1. Create a **server action** `loginAction({ email, password, code? })` in `src/app/signin/actions.ts`:
   - rate-limit (see `~/lib/rate-limit`),
   - check email + password (DB lookup + `verifyPassword`) → if KO `bad_credentials`,
   - if `isTwoFactorEnabled(userId)`: require `code` (`2fa_required` if absent), check `verifyTotp(secret, code) || consumeUserBackupCode(userId, code)` → `invalid_code` otherwise,
   - emit a **signed proof** (HMAC `AUTH_SECRET`, like admin mode: create a reduced `src/lib/auth-2fa.ts` with `createLoginProof`/`verifyLoginProof`) and call `signIn("credentials", { email, proof, redirect: false })`.
2. Adapt the **Credentials provider** in `src/server/auth.ts`: a `proof` field instead of (or in addition to) `password`; `authorize` rechecks the password **or** validates the proof `verifyLoginProof`. Keep the user DB lookup (id, email…).
3. Adapt `src/app/signin/page.tsx`: 2 steps (email+password → if `2fa_required`, a code field), reusing the admin signin pattern (`credentials`/`2fa` states).

> This is the only part that touches the core of the auth. Implement it carefully, check the build, and **test end to end**: enable 2FA on a test account, log out, log back in (the code must be requested), test a wrong code, test a backup code, and verify that an account WITHOUT 2FA still logs in with password only.

---

## Step 7 - CLAUDE.md + summary

`_update-claude-md` (section `## Two-factor authentication (2FA)` on the users side: optional per account, tables `user_two_factor` / `user_backup_code`, helpers `src/lib/{totp,user-2fa}.ts`, actions `account/two-factor-actions.ts`, 2FA step at login).

Summary to the user:
> ## ✅ Two-factor authentication available for your users
> Each user can enable it from their **Account** page ("Security"): they scan a QR in **<AUTH_APP>**, confirm a code, and receive 8 backup codes (shown once in their browser). At the next login, they will be asked for their code after the password. Accounts that do not enable it keep going with password only.

---

## Implementation note

This sub-skill is **piloted by Claude** (no deterministic script) because the Account page and the login flow are project-specific. The secrets/codes **never go through the chat**: enrollment happens in the user's browser. To be **tested on a real user-auth project** before relying on it in production.
