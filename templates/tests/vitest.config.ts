import { defineConfig } from "vitest/config";

/**
 * Configuration des tests (installée par /add-test, Hypervibe).
 *
 * - `resolve.tsconfigPaths` résout l'alias `~/` du projet T3 dans les tests
 *   (natif depuis Vite 7 / vitest 4, plus besoin du plugin vite-tsconfig-paths).
 * - `SKIP_ENV_VALIDATION=1` : le module `~/env` valide les variables au
 *   chargement et refuse de démarrer sans elles ; en test, on ne veut ni
 *   vraie base ni vraies clés.
 * - Environnement `node` : les tests exercent le serveur (procédures tRPC,
 *   fonctions métier). Pour tester un composant React, ajouter `jsdom` au
 *   cas par cas avec `// @vitest-environment jsdom` en tête du fichier.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // next-auth importe `next/server` depuis son propre dossier, que vitest ne
    // sait pas résoudre dans une installation pnpm : on lui fait transformer
    // next-auth comme du code du projet, où `next` est installé. Sans effet
    // si le projet n'a pas d'authentification.
    server: { deps: { inline: ["next-auth", "@auth/core"] } },
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    env: {
      SKIP_ENV_VALIDATION: "1",
      NODE_ENV: "test",
    },
  },
});
