// agent/ai.ts - Le point de passage unique du worker vers l'IA.
//
// Jumeau de `src/server/ai.ts` côté application, adapté à ce runtime : le
// worker vit à côté de l'app, il n'importe donc pas son code, mais il applique
// exactement la même politique.
//
//   - un seul endroit qui parle au fournisseur, donc un seul endroit à relire
//     pour savoir ce qui sort d'ici ;
//   - `data_collection: "deny"` sur chaque appel, donc aucun fournisseur qui
//     s'entraîne sur ce qui passe ;
//   - le coût vient d'OpenRouter, il n'est jamais recalculé de notre côté : un
//     prix recopié dans le code se périme sans prévenir ;
//   - la clé est plafonnée côté OpenRouter, donc même une boucle emballée ne
//     peut pas dépasser le budget.
//
// La différence avec la brique de l'app : ici on a besoin des OUTILS, donc
// l'appel renvoie le message brut plutôt qu'un texte.

const API = "https://openrouter.ai/api/v1/chat/completions";

/** Le modèle de l'agent. Écrit par /add-agent au moment du scaffold. */
export const MODELE_AGENT = "__MODELE__";

/**
 * Ce que la politique de confidentialité promet, appliqué à chaque requête.
 * Voir le commentaire jumeau dans `src/server/ai.ts`.
 */
const CONFIDENTIALITE = { data_collection: "deny" as const };

/**
 * Restreindre le routage à des fournisseurs nommés. Vide par défaut.
 * À ne remplir qu'en cas d'exigence de résidence ou de conformité, au prix de
 * la disponibilité. Identifiants OpenRouter, par exemple ["anthropic"].
 */
const FOURNISSEURS_AUTORISES: string[] = [];

export interface AppelOutil {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface DefinitionOutil {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface MessageChat {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: AppelOutil[];
  tool_call_id?: string;
}

export interface UsageModele {
  tokensEntree: number;
  tokensSortie: number;
  /** Jetons servis depuis le cache du fournisseur, quand il le rapporte. */
  tokensCache: number;
  /** Coût réel de l'appel, tel que rapporté par OpenRouter. */
  coutUsd: number;
}

export interface ReponseModele {
  message: { content: string | null; tool_calls?: AppelOutil[] };
  /** "stop" quand le modèle a fini, "tool_calls" quand il demande un outil. */
  finishReason: string;
  usage: UsageModele;
}

export class BudgetEpuiseError extends Error {
  constructor() {
    super(
      "Le budget IA de cet agent est épuisé. Relevez le plafond de sa clé sur openrouter.ai/settings/keys pour reprendre.",
    );
    this.name = "BudgetEpuiseError";
  }
}

/**
 * Un tour de conversation, outils compris.
 *
 * Le format est celui d'OpenAI, qu'OpenRouter expose pour tous les modèles
 * qu'il route : changer de modèle reste une chaîne de caractères à changer.
 */
export async function appelerModele(o: {
  system: string;
  messages: MessageChat[];
  outils: DefinitionOutil[];
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<ReponseModele> {
  const cle = process.env.OPENROUTER_API_KEY;
  if (!cle) {
    throw new Error(
      "OPENROUTER_API_KEY n'est pas défini. L'agent ne peut pas fonctionner sans.",
    );
  }

  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cle}`,
      "Content-Type": "application/json",
      "X-Title": "{{PROJECT_NAME}}",
    },
    body: JSON.stringify({
      model: MODELE_AGENT,
      max_tokens: o.maxTokens,
      messages: [{ role: "system", content: o.system }, ...o.messages],
      ...(o.outils.length ? { tools: o.outils } : {}),
      provider: FOURNISSEURS_AUTORISES.length
        ? { ...CONFIDENTIALITE, only: FOURNISSEURS_AUTORISES }
        : CONFIDENTIALITE,
      // Demande explicite du coût dans la réponse : c'est lui qu'on journalise.
      usage: { include: true },
    }),
    signal: o.signal,
  });

  // 402 = le plafond de la clé est atteint. Ce n'est pas une panne, c'est le
  // garde-fou qui fait son travail, et le disjoncteur doit pouvoir le
  // distinguer d'une vraie erreur.
  if (res.status === 402) throw new BudgetEpuiseError();
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Appel IA refusé (HTTP ${res.status}) : ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: {
      message?: { content?: string | null; tool_calls?: AppelOutil[] };
      finish_reason?: string;
    }[];
    usage?: {
      cost?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };

  const choix = data.choices?.[0];
  const u = data.usage;

  return {
    message: {
      content: choix?.message?.content ?? null,
      tool_calls: choix?.message?.tool_calls,
    },
    finishReason: choix?.finish_reason ?? "stop",
    usage: {
      tokensEntree: u?.prompt_tokens ?? 0,
      tokensSortie: u?.completion_tokens ?? 0,
      tokensCache: u?.prompt_tokens_details?.cached_tokens ?? 0,
      coutUsd: u?.cost ?? 0,
    },
  };
}
