import { db } from "~/server/db";
import { aiUsage } from "~/server/db/schema";
import { env } from "~/env.js";

/**
 * Le point de passage unique vers l'IA de cette application.
 *
 * Tout appel de modèle passe par ici, et jamais par un `fetch` écrit à côté :
 * c'est ce qui garantit qu'aucun appel n'échappe au plafond de jetons, au
 * journal des coûts ni à la politique de confidentialité. Ajouter une
 * fonctionnalité intelligente veut dire ajouter une entrée dans `MODELES`,
 * pas ouvrir une nouvelle route vers le fournisseur.
 *
 * Le fournisseur est OpenRouter, qui expose l'API d'OpenAI et route vers des
 * centaines de modèles. Trois conséquences utiles :
 *   - changer de modèle est une chaîne de caractères à changer, pas une
 *     migration de bibliothèque ;
 *   - la réponse porte le COÛT RÉEL de l'appel, qu'on enregistre ;
 *   - la clé est plafonnée côté OpenRouter, donc même une boucle infinie ne
 *     peut pas dépasser le budget.
 */

const API = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Le modèle de chaque usage, et le nombre de jetons qu'il a le droit de
 * produire. `maxTokens` n'est pas une optimisation : c'est la borne qui évite
 * qu'une réponse partie en boucle coûte cent fois le prix d'une réponse
 * normale.
 */
export const MODELES = {
  // __MODELES__
} as const;

export type UsageIA = keyof typeof MODELES;

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OptionsAppel {
  usage: UsageIA;
  messages: Message[];
  /** Qui déclenche l'appel, pour le journal des coûts. NULL = tâche de fond. */
  userId?: string | null;
  /** Température : 0 pour classer ou extraire, 0.7 pour rédiger. */
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Ce que la politique de confidentialité promet, appliqué à chaque requête.
 *
 * `data_collection: "deny"` écarte les fournisseurs qui se réservent le droit
 * d'entraîner sur ce qui passe. C'est la contrepartie technique de l'entrée
 * « OpenRouter » du registre des sous-traitants : sans elle, la mention
 * écrite ne serait qu'une intention.
 */
const CONFIDENTIALITE = { data_collection: "deny" as const };

function corps(o: OptionsAppel, modele: string, maxTokens: number) {
  return {
    model: modele,
    messages: o.messages,
    max_tokens: maxTokens,
    temperature: o.temperature ?? 0.3,
    provider: CONFIDENTIALITE,
  };
}

/**
 * Enregistre ce que l'appel a réellement coûté.
 *
 * Le coût vient d'OpenRouter, il n'est pas recalculé de notre côté : un prix
 * recopié dans le code se périme sans prévenir, et un tableau de bord qui
 * ment sur la dépense est pire que pas de tableau de bord.
 */
async function journaliser(champs: {
  usage: string;
  modele: string;
  userId: string | null;
  tokensEntree: number;
  tokensSortie: number;
  coutUsd: number;
}) {
  try {
    const { coutUsd, ...reste } = champs;
    // La colonne stocke des MILLIONIÈMES de dollar : un appel coûte souvent
    // 0,0002 $, qu'un arrondi au centime ramènerait à zéro, et le total du
    // mois vaudrait zéro lui aussi.
    await db
      .insert(aiUsage)
      .values({ ...reste, coutMicroUsd: Math.round(coutUsd * 1_000_000) });
  } catch (e) {
    // Un journal en panne ne doit jamais faire échouer la fonctionnalité.
    console.error("[ia] coût non enregistré:", e);
  }
}

interface ReponseIA {
  texte: string;
  coutUsd: number;
  tokensEntree: number;
  tokensSortie: number;
}

/** Un appel complet, attendu jusqu'au bout. Pour classer, extraire, rédiger. */
export async function appelerIA(o: OptionsAppel): Promise<ReponseIA> {
  const { modele, maxTokens } = MODELES[o.usage];
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // Renseignés dans les statistiques d'OpenRouter : utile pour savoir
      // quelle application consomme quoi quand il y en a plusieurs.
      "HTTP-Referer": env.NEXT_PUBLIC_SITE_URL ?? "",
      "X-Title": "__APP_NAME__",
    },
    body: JSON.stringify(corps(o, modele, maxTokens)),
    signal: o.signal,
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    // 402 = le plafond de la clé est atteint. Ce n'est pas une panne, c'est le
    // garde-fou qui fait son travail : le message doit le dire clairement.
    if (res.status === 402) {
      throw new Error(
        "Le budget IA du mois est épuisé. Relevez le plafond de la clé sur openrouter.ai/settings/keys pour reprendre.",
      );
    }
    throw new Error(`Appel IA refusé (HTTP ${res.status}) : ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number };
  };

  const texte = data.choices?.[0]?.message?.content ?? "";
  const reponse: ReponseIA = {
    texte,
    coutUsd: data.usage?.cost ?? 0,
    tokensEntree: data.usage?.prompt_tokens ?? 0,
    tokensSortie: data.usage?.completion_tokens ?? 0,
  };

  await journaliser({
    usage: o.usage,
    modele,
    userId: o.userId ?? null,
    tokensEntree: reponse.tokensEntree,
    tokensSortie: reponse.tokensSortie,
    coutUsd: reponse.coutUsd,
  });

  return reponse;
}

/**
 * Un appel diffusé mot à mot, pour une conversation.
 *
 * Le coût n'arrive qu'au tout dernier message du flux : on le lit là, une fois
 * la réponse terminée, et on le journalise comme les autres. Sans ça, le chat
 * serait précisément la fonctionnalité la plus utilisée et la seule absente du
 * tableau des dépenses.
 */
export async function diffuserIA(o: OptionsAppel): Promise<ReadableStream<Uint8Array>> {
  const { modele, maxTokens } = MODELES[o.usage];
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.NEXT_PUBLIC_SITE_URL ?? "",
      "X-Title": "__APP_NAME__",
    },
    body: JSON.stringify({ ...corps(o, modele, maxTokens), stream: true }),
    signal: o.signal,
  });

  if (!res.ok || !res.body) {
    if (res.status === 402) {
      throw new Error(
        "Le budget IA du mois est épuisé. Relevez le plafond de la clé sur openrouter.ai/settings/keys pour reprendre.",
      );
    }
    throw new Error(`Appel IA refusé (HTTP ${res.status}).`);
  }

  const source = res.body.getReader();
  const decodeur = new TextDecoder();
  const encodeur = new TextEncoder();
  let tampon = "";
  let cout = 0;
  let tEntree = 0;
  let tSortie = 0;

  return new ReadableStream({
    async pull(controleur) {
      const { done, value } = await source.read();
      if (done) {
        await journaliser({
          usage: o.usage,
          modele,
          userId: o.userId ?? null,
          tokensEntree: tEntree,
          tokensSortie: tSortie,
          coutUsd: cout,
        });
        controleur.close();
        return;
      }

      tampon += decodeur.decode(value, { stream: true });
      const lignes = tampon.split("\n");
      // La dernière ligne peut être coupée en plein milieu : on la garde pour
      // le tour suivant plutôt que de la parser à moitié.
      tampon = lignes.pop() ?? "";

      for (const ligne of lignes) {
        if (!ligne.startsWith("data: ")) continue;
        const charge = ligne.slice(6).trim();
        if (charge === "[DONE]") continue;
        try {
          const evenement = JSON.parse(charge) as {
            choices?: { delta?: { content?: string } }[];
            usage?: {
              cost?: number;
              prompt_tokens?: number;
              completion_tokens?: number;
            };
          };
          const morceau = evenement.choices?.[0]?.delta?.content;
          if (morceau) controleur.enqueue(encodeur.encode(morceau));
          if (evenement.usage) {
            cout = evenement.usage.cost ?? cout;
            tEntree = evenement.usage.prompt_tokens ?? tEntree;
            tSortie = evenement.usage.completion_tokens ?? tSortie;
          }
        } catch {
          // Un fragment illisible ne doit pas interrompre la conversation.
        }
      }
    },
    cancel() {
      void source.cancel();
    },
  });
}
