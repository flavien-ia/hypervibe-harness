import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "~/server/auth";
import { LinkButton } from "~/components/ui/link-button";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const session = await auth();
  if (!session?.user) {
    redirect("/signin?callbackUrl=/dashboard");
  }

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          {session.user.name
            ? t("welcomeNamed", { name: session.user.name })
            : t("welcome")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t.rich("connectedAs", {
            email: session.user.email ?? "",
            strong: (chunks) => <span className="font-medium">{chunks}</span>,
          })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">{t("accountCardTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("accountCardDescription")}
          </p>
          <LinkButton href="/account" className="mt-4" variant="outline">
            {t("accountCardLink")}
          </LinkButton>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">{t("startCardTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("startCardDescription")}
          </p>
        </div>
      </div>
    </main>
  );
}
