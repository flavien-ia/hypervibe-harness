import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { TOTP, Secret } from "otpauth";

/**
 * Briques 2FA (sans dépendance DB) :
 * - vérification du code TOTP (appli d'authentification)
 * - cookie "appareil de confiance" (2FA demandé 1×/24h par navigateur)
 * - preuve de connexion signée (le serveur d'auth fait confiance à la server
 *   action qui a déjà vérifié mot de passe + 2FA - voir loginAction).
 */

const TRUST_COOKIE = "{{COOKIE_NAME}}";
const TRUST_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PROOF_TTL_MS = 90_000; // 90s

function secretKey(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET manquant");
  return s;
}

function sign(data: string): string {
  return createHmac("sha256", secretKey()).update(data).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/* ── TOTP ────────────────────────────────────────────────────────────── */

export function verifyTotp(token: string): boolean {
  const secret = process.env.ADMIN_TOTP_SECRET;
  if (!secret) return false;
  const clean = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const totp = new TOTP({
    issuer: "{{ISSUER}}",
    label: "admin",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
  // window:1 tolère un décalage d'horloge d'un cran (±30s).
  return totp.validate({ token: clean, window: 1 }) !== null;
}

/* ── Appareil de confiance (cookie 24h) ──────────────────────────────── */

export async function setTrustedDevice(): Promise<void> {
  const exp = String(Date.now() + TRUST_TTL_MS);
  const value = `${exp}.${sign(exp)}`;
  (await cookies()).set(TRUST_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TRUST_TTL_MS / 1000,
  });
}

export async function isTrustedDevice(): Promise<boolean> {
  const raw = (await cookies()).get(TRUST_COOKIE)?.value;
  if (!raw) return false;
  const [exp, mac] = raw.split(".");
  if (!exp || !mac) return false;
  if (!safeEqualHex(mac, sign(exp))) return false;
  return Number(exp) > Date.now();
}

/* ── Preuve de connexion (server action → NextAuth authorize) ─────────── */

export function createLoginProof(username: string): string {
  const ts = String(Date.now());
  return `${ts}.${sign(`${username}.${ts}`)}`;
}

export function verifyLoginProof(username: string, proof: string): boolean {
  const [ts, mac] = proof.split(".");
  if (!ts || !mac) return false;
  if (!safeEqualHex(mac, sign(`${username}.${ts}`))) return false;
  return Date.now() - Number(ts) < PROOF_TTL_MS;
}
