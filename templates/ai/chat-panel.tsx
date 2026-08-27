"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Le panneau de conversation.
 *
 * La réponse s'affiche mot à mot pendant qu'elle arrive : c'est ce qui rend
 * l'attente supportable, une réponse complète mettant plusieurs secondes.
 * L'état vit dans le composant, la conversation n'est donc pas conservée d'une
 * visite à l'autre. C'est volontaire pour une v1 : persister des échanges,
 * c'est stocker de la donnée personnelle, avec la durée de conservation et la
 * suppression que cela implique.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    const texte = saisie.trim();
    if (!texte || enCours) return;

    const suite: Message[] = [...messages, { role: "user", content: texte }];
    setMessages(suite);
    setSaisie("");
    setEnCours(true);
    setErreur(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: suite }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "La réponse n'a pas pu être obtenue.");
      }

      // La bulle de réponse est créée vide, puis remplie au fil du flux.
      setMessages([...suite, { role: "assistant", content: "" }]);
      const lecteur = res.body.getReader();
      const decodeur = new TextDecoder();
      let accumule = "";

      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        accumule += decodeur.decode(value, { stream: true });
        setMessages([...suite, { role: "assistant", content: accumule }]);
      }
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Une erreur est survenue.");
      // La question de la personne reste affichée : elle n'a pas à la retaper.
      setMessages(suite);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted">__MESSAGE_ACCUEIL__</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
              m.role === "user"
                ? "ml-auto bg-primary/15 text-foreground"
                : "bg-surface-2 text-foreground"
            }`}
          >
            <p className="whitespace-pre-wrap">
              {m.content}
              {enCours && i === messages.length - 1 && m.role === "assistant" && (
                <span className="animate-pulse">▍</span>
              )}
            </p>
          </div>
        ))}
        <div ref={finRef} />
      </div>

      {erreur && <p className="text-sm text-coral">{erreur}</p>}

      <form onSubmit={envoyer} className="flex gap-2">
        <input
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder="Votre question..."
          maxLength={4000}
          disabled={enCours}
          className="input-rainbow flex-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-foreground outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={enCours || !saisie.trim()}
          className="btn-rainbow cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {enCours ? "..." : "Envoyer"}
        </button>
      </form>
    </div>
  );
}
