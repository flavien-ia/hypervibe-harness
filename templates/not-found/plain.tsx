import { LinkButton } from "~/components/ui/link-button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="animate-in fade-in duration-700">
        <h1 className="bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-7xl font-extrabold tracking-tight text-transparent sm:text-9xl">
          404
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Cette page n’existe pas.
        </p>
        <LinkButton href="/" className="mt-8">
          Retour à l’accueil
        </LinkButton>
      </div>
    </main>
  );
}
