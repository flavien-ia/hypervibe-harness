import { getTranslations, getLocale } from "next-intl/server";
import { SUBPROCESSORS, type Subprocessor } from "~/lib/subprocessors";

export async function generateMetadata() {
  const t = await getTranslations("privacy");
  return {
    title: `${t("metaTitle")} | {{PROJECT_NAME}}`,
    description: t("metaDescription"),
  };
}

const LAST_UPDATED = "{{LAST_UPDATED}}";
const CONTACT_EMAIL = "contact@example.com";

/**
 * Return the localized value of a subprocessor field. Falls back to the root
 * (French) value when no translation is defined for the active locale.
 */
function localized<K extends "purpose" | "retention" | "legalBasis" | "transferMechanism">(
  sp: Subprocessor,
  field: K,
  locale: string,
): Subprocessor[K] {
  const tr = sp.i18n?.[locale];
  if (tr && field in tr && tr[field] !== undefined) {
    return tr[field] as Subprocessor[K];
  }
  return sp[field];
}

function localizedDataTypes(sp: Subprocessor, locale: string): string[] {
  return sp.i18n?.[locale]?.dataTypes ?? sp.dataTypes;
}

export default async function PrivacyPolicyPage() {
  const t = await getTranslations("privacy");
  const locale = await getLocale();

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <article className="space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">{t("h1")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("lastUpdated", { date: LAST_UPDATED })}
          </p>
        </header>

        <Section title={t("sections.controller.title")}>
          <p>
            {t.rich("sections.controller.intro", {
              strong: (chunks) => <strong>{chunks}</strong>,
              project: "{{PROJECT_NAME}}",
            })}
          </p>
          <p>
            {t.rich("sections.controller.contact", {
              a: (chunks) => (
                <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">
                  {chunks}
                </a>
              ),
              email: CONTACT_EMAIL,
            })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("sections.controller.placeholder")}
          </p>
        </Section>

        <Section title={t("sections.collected.title")}>
          <p>
            {t.rich("sections.collected.body", {
              em: (chunks) => <em>{chunks}</em>,
            })}
          </p>
        </Section>

        <Section title={t("sections.legalBasis.title")}>
          <p>{t("sections.legalBasis.body")}</p>
        </Section>

        <Section title={t("sections.subprocessors.title")}>
          <p>{t("sections.subprocessors.intro")}</p>

          <div className="mt-4 space-y-4">
            {SUBPROCESSORS.map((sp) => (
              <div
                key={sp.key}
                className="rounded-lg border border-border bg-card p-5 text-card-foreground"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold">{sp.name}</h3>
                    <p className="text-sm text-muted-foreground">{sp.address}</p>
                  </div>
                  <span
                    className={
                      sp.isEUResident
                        ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-900 dark:bg-green-900/30 dark:text-green-200"
                        : "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
                    }
                  >
                    {sp.isEUResident
                      ? t("regions.eu")
                      : t("regions.nonEu")}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-4">
                  <dt className="font-medium">{t("sections.subprocessors.labels.purpose")}</dt>
                  <dd>{localized(sp, "purpose", locale)}</dd>

                  <dt className="font-medium">{t("sections.subprocessors.labels.dataTypes")}</dt>
                  <dd>
                    <ul className="list-disc pl-5">
                      {localizedDataTypes(sp, locale).map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </dd>

                  <dt className="font-medium">{t("sections.subprocessors.labels.retention")}</dt>
                  <dd>{localized(sp, "retention", locale)}</dd>

                  <dt className="font-medium">{t("sections.subprocessors.labels.legalBasis")}</dt>
                  <dd>{localized(sp, "legalBasis", locale)}</dd>

                  {sp.transferMechanism ? (
                    <>
                      <dt className="font-medium">
                        {t("sections.subprocessors.labels.transferMechanism")}
                      </dt>
                      <dd>{localized(sp, "transferMechanism", locale)}</dd>
                    </>
                  ) : null}

                  <dt className="font-medium">{t("sections.subprocessors.labels.moreInfo")}</dt>
                  <dd className="flex flex-wrap gap-x-4 gap-y-1">
                    <a
                      href={sp.privacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {t("sections.subprocessors.labels.privacyPolicy")}
                    </a>
                    {sp.dpaUrl ? (
                      <a
                        href={sp.dpaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {t("sections.subprocessors.labels.dpa")}
                      </a>
                    ) : null}
                  </dd>
                </dl>
              </div>
            ))}
          </div>
        </Section>

        <Section title={t("sections.rights.title")}>
          <p>{t("sections.rights.intro")}</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>{t("sections.rights.items.access")}</li>
            <li>{t("sections.rights.items.erasure")}</li>
            <li>{t("sections.rights.items.portability")}</li>
            <li>{t("sections.rights.items.objection")}</li>
            <li>{t("sections.rights.items.withdrawConsent")}</li>
            <li>
              {t.rich("sections.rights.items.complaint", {
                a: (chunks) => (
                  <a
                    href="https://www.cnil.fr"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </li>
          </ul>
          <p>
            {t.rich("sections.rights.exercise", {
              a: (chunks) => (
                <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">
                  {chunks}
                </a>
              ),
              email: CONTACT_EMAIL,
            })}
          </p>
        </Section>

        <Section title={t("sections.cookies.title")}>
          <p>{t("sections.cookies.body1")}</p>
          <p>{t("sections.cookies.body2")}</p>
        </Section>

        <Section title={t("sections.modifications.title")}>
          <p>{t("sections.modifications.body")}</p>
        </Section>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
