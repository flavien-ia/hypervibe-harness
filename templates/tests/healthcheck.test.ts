// recette: R-01
import { describe, expect, it } from "vitest";
import { caller } from "./helpers/caller";

/**
 * Premier test du projet (installé par /add-test, Hypervibe) : l'API répond.
 * Il couvre la ligne R-01 du cahier de recette. Chaque test porte ainsi
 * l'identifiant de la ligne qu'il vérifie, en commentaire, en tête de fichier
 * ou juste au-dessus du `it` : c'est ce qui relie le cahier aux tests.
 */
describe("healthcheck", () => {
  it("répond « ok » avec un horodatage valide (R-01)", async () => {
    const api = caller();
    const reponse = await api.healthcheck.ping();
    expect(reponse.status).toBe("ok");
    expect(Number.isNaN(Date.parse(reponse.timestamp))).toBe(false);
  });
});
