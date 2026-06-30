// Goes to: apps/web/src/app/admin/agents/[name]/page.tsx
//
// Shows for one agent: cost stats (last 30 days), recent invocations,
// "Trigger now" form. Click an invocation → /admin/agents/<name>/invocations/<id>.
//
// Server component for the data fetch + auth, with a client island for
// the trigger form.

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { isAdmin } from "~/server/auth";
import { api } from "~/trpc/server";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { TriggerForm } from "./trigger-form";

interface PageProps {
  params: Promise<{ name: string }>;
}

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
  success: { label: "Réussi", variant: "default" },
  error: { label: "Erreur", variant: "destructive" },
  budget_killed: { label: "Plafond", variant: "destructive" },
  max_iterations_reached: { label: "Trop de tours", variant: "secondary" },
  running: { label: "En cours", variant: "secondary" },
};

export default async function AgentDetailPage({ params }: PageProps) {
  if (!(await isAdmin())) redirect("/admin/signin");
  const { name } = await params;

  const [stats, invocationsPage] = await Promise.all([
    api.agentDashboard.costStats({ agentName: name }),
    api.agentDashboard.listInvocations({ agentName: name, limit: 50 }),
  ]);

  if (invocationsPage.items.length === 0 && stats.totalInvocationsLast30d === 0) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-2 flex items-center gap-2">
        <Link href="/admin/agents" className="text-sm text-muted-foreground hover:underline">
          ← Tous les agents
        </Link>
      </div>
      <h1 className="mb-8 text-3xl font-semibold">{name}</h1>

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Coût 30 derniers jours</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">${stats.totalCostLast30d.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">{stats.totalInvocationsLast30d} exécutions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Lancer maintenant</CardTitle>
          </CardHeader>
          <CardContent>
            <TriggerForm agentName={name} />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-4 text-xl font-semibold">Exécutions récentes</h2>
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Déclenché par</th>
              <th className="px-4 py-2 text-left font-medium">Statut</th>
              <th className="px-4 py-2 text-right font-medium">Tours</th>
              <th className="px-4 py-2 text-right font-medium">Coût</th>
            </tr>
          </thead>
          <tbody>
            {invocationsPage.items.map((inv) => {
              const status = STATUS_LABEL[inv.status] ?? { label: inv.status, variant: "secondary" as const };
              return (
                <tr key={inv.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link href={`/admin/agents/${name}/invocations/${inv.id}`} className="hover:underline">
                      {new Date(inv.startedAt).toLocaleString("fr-FR")}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{inv.triggeredBy}</td>
                  <td className="px-4 py-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">{inv.iterations}</td>
                  <td className="px-4 py-2 text-right">${Number(inv.totalCostUsd).toFixed(4)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
