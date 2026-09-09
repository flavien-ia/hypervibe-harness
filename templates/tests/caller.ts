import { appRouter } from "~/server/api/root";
import { createCallerFactory } from "~/server/api/trpc";
import { db } from "~/server/db";

/**
 * Un appelant tRPC pour les tests (installé par /add-test, Hypervibe).
 *
 * `caller()` exerce une procédure exactement comme le ferait l'app, sans
 * serveur HTTP : `await caller().healthcheck.ping()`. Le contexte est
 * minimal ; on lui passe ce dont le test a besoin :
 *
 *   caller()                                     visiteur anonyme
 *   caller({ session: { user: { id: "u1" } } })  personne connectée
 *   caller({ headers: new Headers({ "x-forwarded-for": "10.0.0.1" }) })
 *
 * Base simulée : les procédures lisent et écrivent par `ctx.db`, et le
 * contexte ci-dessous prend le `db` du module `~/server/db`. Un test qui
 * touche la base simule donc ce module, et c'est la simulation qui arrive
 * dans le contexte :
 *
 *   vi.mock("~/server/db", () => ({ db: { query: { posts: { findMany: async () => [] } } } }));
 *
 * Sans simulation, `db` est le vrai client, pointé sur l'adresse factice de
 * `tests/setup.ts` : une procédure qui l'appellerait échouerait, et c'est
 * voulu, un test ne parle jamais à une vraie base. Les procédures qui ne
 * touchent pas la base (healthcheck, calculs, validation d'entrée) n'ont
 * besoin de rien.
 *
 * Projet sans base de données (pas de `src/server/db`) : retirer l'import de
 * `db` et la propriété `db` du contexte ci-dessous.
 */
const createCaller = createCallerFactory(appRouter);

type Contexte = Parameters<typeof createCaller>[0];

export function caller(overrides: Partial<Contexte> = {}) {
  const base = {
    headers: new Headers(),
    session: null,
    db,
  };
  // Le contexte réel dépend du projet (base, session, en-têtes) : on part d'un
  // socle minimal et le test complète ce dont sa procédure a besoin.
  return createCaller({ ...base, ...overrides } as Contexte);
}
