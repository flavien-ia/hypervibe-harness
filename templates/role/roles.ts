// hypervibe:roles {{ROLES_CSV}}
//
// Roles are stored as a Postgres enum array on the `users` table. A user may
// have one or several roles. Helpers below abstract the storage and provide a
// thin layer of ergonomic checks (`hasRole`, `requireRole`) usable from any
// server component or tRPC procedure.
//
// Naming convention: the role `admin` is RESERVED for the credentials admin
// configured by `/add-auth` in admin mode (env var, never in DB). It must NOT
// appear in the enum below. Use names like `moderator`, `manager`, `superviseur`
// for DB users who need elevated privileges.

import type { Session } from "next-auth";

export const ROLES = [{{ROLES_TUPLE}}] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_ROLE: Role = "{{DEFAULT_ROLE}}";

/**
 * Human-readable labels for UI display. Keys must match exactly the strings in
 * `ROLES`. Update this map when you add or rename a role.
 */
export const ROLE_LABELS: Record<Role, string> = {
{{ROLE_LABELS_ENTRIES}}
};

/**
 * True if the session's user has ANY of the allowed roles. Returns false for
 * unauthenticated sessions or sessions without a `roles` array (e.g. the
 * credentials admin from /add-auth admin mode : use `isAdmin()` from
 * ~/server/auth to check that one).
 */
export function hasRole(session: Session | null, allowed: readonly Role[]): boolean {
  const roles = session?.user?.roles;
  if (!Array.isArray(roles) || roles.length === 0) return false;
  return roles.some((r) => allowed.includes(r as Role));
}

/**
 * Returns the array of roles for the current session, or [] if none.
 * Useful for UI conditionals that want to render different elements per role.
 */
export function getRoles(session: Session | null): Role[] {
  const roles = session?.user?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.filter((r): r is Role => (ROLES as readonly string[]).includes(r));
}
