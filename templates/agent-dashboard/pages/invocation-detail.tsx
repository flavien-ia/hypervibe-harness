// Goes to: apps/web/src/app/admin/agents/[name]/invocations/[id]/page.tsx
//
// Full reasoning trace of one agent invocation: every loop turn, every tool
// call, every cost number. This is the page admin opens when something went
// wrong and they want to understand why.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { isAdmin } from "~/server/auth";
import { api } from "~/trpc/server";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";

interface PageProps {
  params: Promise<{ name: string; id: string }>;
}

export default async function InvocationDetailPage({ params }: PageProps) {
  if (!(await isAdmin())) redirect("/admin/signin");
  const { name, id } = await params;

  let data;
  try {
    data = await api.agentDashboard.getInvocation({ invocationId: id });
  } catch {
    notFound();
  }
  const { invocation, turns } = data;

  const durationSec = invocation.finishedAt
    ? (new Date(invocation.finishedAt).getTime() - new Date(invocation.startedAt).getTime()) / 1000
    : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <div className="mb-2">
        <Link href={`/admin/agents/${name}`} className="text-sm text-muted-foreground hover:underline">
          ← Toutes les exécutions de {name}
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-semibold">Exécution {invocation.id.slice(0, 8)}</h1>
      <div className="mb-6 flex flex-wrap gap-2 text-sm text-muted-foreground">
        <Badge variant={invocation.status === "success" ? "default" : invocation.status === "error" || invocation.status === "budget_killed" ? "destructive" : "secondary"}>
          {invocation.status}
        </Badge>
        <span>•</span>
        <span>{new Date(invocation.startedAt).toLocaleString("fr-FR")}</span>
        {durationSec !== null && <><span>•</span><span>{durationSec.toFixed(1)} s</span></>}
        <span>•</span>
        <span>{invocation.iterations} tour(s)</span>
        <span>•</span>
        <span>${Number(invocation.totalCostUsd).toFixed(4)}</span>
      </div>

      {invocation.errorMessage && (
        <Card className="mb-6 border-red-500/50 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-base text-red-700">Erreur</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm">{invocation.errorMessage}</pre>
          </CardContent>
        </Card>
      )}

      {invocation.promptPreview && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Prompt</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{invocation.promptPreview}</pre>
          </CardContent>
        </Card>
      )}

      <h2 className="mb-4 text-xl font-semibold">Chaîne de pensée - {turns.length} tour(s)</h2>
      <div className="space-y-4">
        {turns.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>Tour {t.turnNumber}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t.stopReason} · {t.inputTokens + t.outputTokens} tokens · ${Number(t.costUsd).toFixed(4)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(t.content as Array<{ type: string; text?: string; name?: string; input?: unknown; tool_use_id?: string }>).map((block, i) => {
                if (block.type === "text" && block.text) {
                  return (
                    <div key={i} className="rounded bg-muted/50 p-3 whitespace-pre-wrap">
                      {block.text}
                    </div>
                  );
                }
                if (block.type === "tool_use") {
                  return (
                    <div key={i} className="rounded border border-blue-500/30 bg-blue-500/5 p-3">
                      <div className="mb-1 text-xs font-medium text-blue-700">🔧 Tool : {block.name}</div>
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {JSON.stringify(block.input, null, 2)}
                      </pre>
                    </div>
                  );
                }
                return null;
              })}
            </CardContent>
          </Card>
        ))}
      </div>

      {invocation.finalText && (
        <Card className="mt-8 border-green-500/50">
          <CardHeader>
            <CardTitle className="text-base">Réponse finale</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm">{invocation.finalText}</pre>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
