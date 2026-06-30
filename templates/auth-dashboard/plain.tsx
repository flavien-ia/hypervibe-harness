import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { LinkButton } from "~/components/ui/link-button";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin?callbackUrl=/dashboard");
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          Bienvenue{session.user.name ? `, ${session.user.name}` : ""} 👋
        </h1>
        <p className="mt-2 text-muted-foreground">
          Tu es connecté en tant que <span className="font-medium">{session.user.email}</span>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Ton compte</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Gère ton email, ton nom, ou supprime ton compte.
          </p>
          <LinkButton href="/account" className="mt-4" variant="outline">
            Aller à mon compte
          </LinkButton>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Démarrer</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Cette page est ton tableau de bord par défaut. Personnalise-la selon ton app.
          </p>
        </div>
      </div>
    </main>
  );
}
