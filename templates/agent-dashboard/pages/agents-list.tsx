// Goes to: apps/web/src/app/admin/agents/page.tsx
//
// Lists all agents that have at least one invocation, with their key stats.
// Click on an agent → navigates to /admin/agents/<name> for detail.
//
// Server component → auth check + initial fetch via tRPC server-side.

import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "~/server/auth";
import { api } from "~/trpc/server";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export default async function AgentsListPage() {
  if (!(await isAdmin())) redirect("/admin/signin?callbackUrl=/admin/agents");

  const agents = await api.agentDashboard.listAgents();

  if (agents.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="mb-2 text-3xl font-semibold">Agents IA</h1>
        <p className="text-muted-foreground">
          Aucun agent n’a encore tourné. Lance <code>/add-agent</code> dans Claude Code pour en créer un.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="mb-8 text-3xl font-semibold">Agents IA</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {agents.map((a) => {
          const total = a.totalInvocations;
          const successPct = total > 0 ? Math.round((a.successCount / total) * 100) : 0;
          return (
            <Link key={a.agentName} href={`/admin/agents/${a.agentName}`} className="block">
              <Card className="cursor-pointer transition hover:border-foreground/30">
                <CardHeader>
                  <CardTitle>{a.agentName}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exécutions</span>
                    <span className="font-medium">{total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Réussies</span>
                    <span className="font-medium">{a.successCount} ({successPct}%)</span>
                  </div>
                  {a.errorCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Erreurs</span>
                      <span className="font-medium text-red-600">{a.errorCount}</span>
                    </div>
                  )}
                  {a.budgetKilledCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Plafond atteint</span>
                      <span className="font-medium text-orange-600">{a.budgetKilledCount}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Coût total</span>
                    <span className="font-medium">${a.totalCostUsd.toFixed(2)}</span>
                  </div>
                  {a.lastRun && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dernière exécution</span>
                      <span className="font-medium">{new Date(a.lastRun).toLocaleString("fr-FR")}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
