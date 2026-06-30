"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const request = api.auth.requestPasswordReset.useMutation();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await request.mutateAsync({ email });
    // Always show the same confirmation regardless of whether the email exists
    // (anti-enumeration). The backend already enforces this.
    setSubmitted(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Mot de passe oublié ?</CardTitle>
          <CardDescription>
            Entre ton email. Si un compte existe avec cette adresse, on t’envoie un lien pour
            choisir un nouveau mot de passe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="grid gap-4">
              <p className="text-sm">
                Email envoyé ! Vérifie ta boîte de réception (et tes spams si tu ne le vois pas).
                Le lien est valide 1 heure.
              </p>
              <Link
                href="/signin"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Retour à la connexion
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={request.isPending}
                className="w-full cursor-pointer"
              >
                {request.isPending ? "Envoi en cours…" : "Envoyer le lien"}
              </Button>
              <Link
                href="/signin"
                className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Retour à la connexion
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
