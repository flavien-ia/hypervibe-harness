import { verifyPassword } from "~/lib/password";

/**
 * Codes de secours 2FA, stockés hachés (scrypt salt:hash) dans la variable
 * d'environnement `ADMIN_2FA_BACKUP_HASHES` (tableau JSON de hashs).
 *
 * Note : sans base de données, l'usage unique n'est pas tracé - un code reste
 * valable tant qu'il n'est pas régénéré. Pour un accès owner-only protégé par
 * mot de passe + TOTP, c'est un compromis acceptable. (Pour un usage unique
 * strict, régénérer les codes après chaque utilisation, ou stocker l'état en DB.)
 */
export async function consumeBackupCode(code: string): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return false;

  let hashes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(process.env.ADMIN_2FA_BACKUP_HASHES ?? "[]");
    if (Array.isArray(parsed)) hashes = parsed.filter((h): h is string => typeof h === "string");
  } catch {
    return false;
  }

  for (const h of hashes) {
    if (await verifyPassword(normalized, h)) return true;
  }
  return false;
}
