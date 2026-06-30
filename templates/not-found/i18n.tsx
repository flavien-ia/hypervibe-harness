import { getTranslations } from "next-intl/server";
import { Link } from "~/i18n/navigation";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="animate-in fade-in duration-700">
        <h1 className="bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-7xl font-extrabold tracking-tight text-transparent sm:text-9xl">
          404
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {t("description")}
        </p>
        <Link href="/" className={cn(buttonVariants(), "mt-8")}>
          {t("backHome")}
        </Link>
      </div>
    </main>
  );
}
