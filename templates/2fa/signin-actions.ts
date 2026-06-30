"use server";

import { headers } from "next/headers";
import { signIn } from "~/server/auth";
import { verifyPassword, getAdminPasswordHash } from "~/lib/password";
import {
  verifyTotp,
  isTrustedDevice,
  setTrustedDevice,
  createLoginProof,
} from "~/lib/auth-2fa";
import { consumeBackupCode } from "~/lib/auth-backup-codes";
import { checkRateLimit } from "~/lib/rate-limit";

export type LoginResult =
  | { status: "ok" }
  | { status: "bad_credentials" }
  | { status: "2fa_required" }
  | { status: "invalid_code" }
  | { status: "rate_limited"; minutes: number }
  | { status: "error" };

export async function loginAction(input: {
  username: string;
  password: string;
  code?: string;
}): Promise<LoginResult> {
  try {
    const ip =
      (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const { allowed, retryAfterMs } = checkRateLimit(`login:${ip}`);
    if (!allowed) {
      return { status: "rate_limited", minutes: Math.ceil((retryAfterMs ?? 0) / 60000) };
    }

    const username = input.username?.trim();
    const password = input.password;
    if (!username || !password) return { status: "bad_credentials" };

    const expectedUsername = process.env.ADMIN_USERNAME ?? "admin";
    if (username !== expectedUsername) return { status: "bad_credentials" };

    const passwordOk = await verifyPassword(password, getAdminPasswordHash());
    if (!passwordOk) return { status: "bad_credentials" };

    // 2e facteur - sauf si l'appareil est déjà de confiance (< 24h).
    const trusted = await isTrustedDevice();
    if (!trusted) {
      const code = input.code?.trim();
      if (!code) return { status: "2fa_required" };
      const codeOk = verifyTotp(code) || (await consumeBackupCode(code));
      if (!codeOk) return { status: "invalid_code" };
      await setTrustedDevice();
    }

    // Émet la preuve signée puis ouvre la session NextAuth.
    const proof = createLoginProof(username);
    await signIn("credentials", { username, proof, redirect: false });

    return { status: "ok" };
  } catch {
    return { status: "error" };
  }
}
