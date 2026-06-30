"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "~/i18n/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export default function ForgotPasswordPage() {
  const t = useTranslations("forgotPassword");
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
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="grid gap-4">
              <p className="text-sm">{t("successMessage")}</p>
              <Link
                href="/signin"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                {t("backToSignin")}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">{t("emailLabel")}</Label>
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
                {request.isPending ? t("submitPending") : t("submit")}
              </Button>
              <Link
                href="/signin"
                className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                {t("backToSignin")}
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
