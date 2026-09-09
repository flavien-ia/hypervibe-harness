/**
 * Préparation commune à tous les tests (installée par /add-test, Hypervibe).
 *
 * Les tests ne touchent JAMAIS une vraie base ni un vrai service : les
 * variables ci-dessous sont des valeurs de forme, juste suffisantes pour que
 * les modules du serveur se chargent. Une procédure qui lit la base reçoit une
 * base simulée (voir `tests/helpers/caller.ts`).
 */
import { vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret";

// `server-only` refuse d'être importé hors d'un Server Component. Ici c'est le
// test qui importe le serveur, à dessein : on le neutralise.
vi.mock("server-only", () => ({}));

// Le cache de Next n'existe pas hors d'une requête : ses fonctions deviennent
// des témoins (on peut vérifier qu'une mutation a bien demandé la revalidation).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
