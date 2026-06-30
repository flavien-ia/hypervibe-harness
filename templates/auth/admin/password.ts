import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

/**
 * Hash a password with scrypt. Output format: `salt:hash` (hex:hex).
 * scrypt is preferred over bcrypt because bcrypt hashes contain `$` characters
 * that break shell piping and `vercel env add` quoting.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

/**
 * Verify a plain password against a stored `salt:hash`. Uses timingSafeEqual
 * to prevent timing attacks.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const stored = Buffer.from(hash, "hex");
  if (stored.length !== buf.length) return false;
  return timingSafeEqual(buf, stored);
}

/**
 * Return the active admin password hash, picked by NODE_ENV.
 * - production → ADMIN_PASSWORD_HASH_PROD
 * - anything else → ADMIN_PASSWORD_HASH_DEV
 */
export function getAdminPasswordHash(): string {
  const hash =
    process.env.NODE_ENV === "production"
      ? process.env.ADMIN_PASSWORD_HASH_PROD
      : process.env.ADMIN_PASSWORD_HASH_DEV;
  if (!hash) {
    throw new Error(
      "ADMIN_PASSWORD_HASH_DEV (dev) or ADMIN_PASSWORD_HASH_PROD (prod) is not set",
    );
  }
  return hash;
}
