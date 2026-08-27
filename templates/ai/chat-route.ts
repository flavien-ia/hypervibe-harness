import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "~/server/auth";
import { diffuserIA } from "~/server/ai";

export const runtime = "nodejs";
// Une conversation ne se met pas en cache : chaque réponse est unique.
export const dynamic = "force-dynamic";

/**
 * La route de conversation.
 *
 * Trois garde-fous, et aucun n'est facultatif quand l'IA est exposée à des
 * gens : ils sont ce qui sépare une fonctionnalité d'une facture ouverte.
 *   1. L'historique envoyé est BORNÉ. Sans ça, une conversation qui dure fait
 *      grossir le contexte à chaque tour, et le coût d'un échange grimpe avec
 *      la longueur de la discussion.
 *   2. La consigne de système est écrite ICI, jamais reçue du client : sinon
 *      n'importe qui reprogramme l'assistant depuis sa console.
 *   3. Le nombre de messages par personne et par heure est limité.
 */

const MAX_MESSAGES_HISTORIQUE = 12;
const MAX_CARACTERES = 4000;

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(MAX_CARACTERES),
      }),
    )
    .min(1)
    .max(50),
});

const CONSIGNE = `__CONSIGNE_SYSTEME__`;

export async function POST(req: Request) {
  // __GARDE_ACCES__

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Message invalide." }, { status: 400 });
  }

  // On ne garde que la fin de la conversation : le début coûte à chaque tour
  // et n'apporte plus grand-chose passé une douzaine d'échanges.
  const historique = parsed.data.messages.slice(-MAX_MESSAGES_HISTORIQUE);

  try {
    const flux = await diffuserIA({
      usage: "chat",
      userId: __USER_ID__,
      temperature: 0.6,
      messages: [{ role: "system", content: CONSIGNE }, ...historique],
      signal: req.signal,
    });
    return new NextResponse(flux, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        // Empêche la mise en tampon par les proxys : sans cet en-tête, la
        // réponse arrive d'un bloc et l'effet « mot à mot » disparaît.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Appel impossible.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
