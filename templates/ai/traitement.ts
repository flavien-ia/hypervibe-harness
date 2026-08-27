import { z } from "zod";
import { appelerIA } from "~/server/ai";

/**
 * Faire lire quelque chose à l'IA et en tirer une donnée EXPLOITABLE.
 *
 * La forme compte : un modèle qui répond en prose oblige à parser du texte
 * libre, ce qui casse au premier changement de formulation. On lui demande
 * donc du JSON, et on le valide avec le même zod que partout ailleurs dans le
 * projet. Ce qui ne passe pas la validation est traité comme une panne, jamais
 * comme un résultat approximatif : une classification fausse qui se propage en
 * base coûte plus cher qu'un appel raté.
 */

/** Ce qu'on attend en retour. À adapter au besoin réel du projet. */
export const schemaResultat = z.object({
  // __SCHEMA_CHAMPS__
});

export type Resultat = z.infer<typeof schemaResultat>;

const CONSIGNE = `__CONSIGNE_SYSTEME__

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour et sans bloc de code.`;

/**
 * Extrait le JSON d'une réponse de modèle.
 *
 * Même avec une consigne explicite, un modèle encadre parfois sa réponse d'un
 * bloc de code ou d'une phrase d'introduction. Plutôt que de le lui reprocher,
 * on récupère le premier objet complet : c'est un cas trop fréquent pour être
 * traité comme une erreur.
 */
function extraireJson(texte: string): unknown {
  const nettoye = texte
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(nettoye);
  } catch {
    const debut = nettoye.indexOf("{");
    const fin = nettoye.lastIndexOf("}");
    if (debut >= 0 && fin > debut) {
      return JSON.parse(nettoye.slice(debut, fin + 1));
    }
    throw new Error("La réponse du modèle n'est pas du JSON.");
  }
}

export async function traiterAvecIA(
  contenu: string,
  opts: { userId?: string | null } = {},
): Promise<{ resultat: Resultat; coutUsd: number }> {
  const reponse = await appelerIA({
    usage: "traitement",
    userId: opts.userId ?? null,
    // Zéro : on veut la même sortie pour la même entrée. La créativité est
    // une qualité pour rédiger, un défaut pour classer.
    temperature: 0,
    messages: [
      { role: "system", content: CONSIGNE },
      { role: "user", content: contenu },
    ],
  });

  const brut = extraireJson(reponse.texte);
  const valide = schemaResultat.safeParse(brut);
  if (!valide.success) {
    throw new Error(
      `Réponse du modèle inexploitable : ${valide.error.issues[0]?.message ?? "forme inattendue"}`,
    );
  }

  return { resultat: valide.data, coutUsd: reponse.coutUsd };
}
