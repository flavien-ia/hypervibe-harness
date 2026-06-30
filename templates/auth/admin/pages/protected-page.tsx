import { signOut } from "~/server/auth";
import { Button } from "~/components/ui/button";

export default function AdminHomePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Espace admin</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/admin/signin" });
          }}
        >
          <Button variant="outline" type="submit" className="cursor-pointer">
            Se déconnecter
          </Button>
        </form>
      </div>
      <p className="mt-6 text-muted-foreground">
        Bienvenue dans ton espace admin. C’est ici que tu géreras les contenus
        de ton site. Demande à Claude d’ajouter les pages dont tu as besoin
        (par exemple : « ajoute une page pour gérer les réservations »).
      </p>
    </main>
  );
}
