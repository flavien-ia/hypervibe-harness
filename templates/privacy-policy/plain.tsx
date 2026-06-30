import { SUBPROCESSORS } from "~/lib/subprocessors";

export const metadata = {
  title: "Politique de confidentialité | {{PROJECT_NAME}}",
  description: "Politique de confidentialité et traitement des données personnelles.",
};

const LAST_UPDATED = "{{LAST_UPDATED}}";
const CONTACT_EMAIL = "contact@example.com";

export default function PrivacyPolicyPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <article className="space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Politique de confidentialité</h1>
          <p className="mt-2 text-sm text-muted-foreground">Dernière mise à jour : {LAST_UPDATED}</p>
        </header>

        <Section title="1. Responsable du traitement">
          <p>
            Le responsable du traitement des données collectées via ce site est{" "}
            <strong>{"{{PROJECT_NAME}}"}</strong>.
          </p>
          <p>
            Pour toute question relative à vos données personnelles :{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">
              {CONTACT_EMAIL}
            </a>.
          </p>
          <p className="text-sm text-muted-foreground">
            Pensez à remplacer cette adresse par votre adresse de contact réelle avant la mise en
            production.
          </p>
        </Section>

        <Section title="2. Données collectées et finalités">
          <p>
            Les données personnelles collectées dépendent des fonctionnalités que vous utilisez. La
            liste exhaustive figure dans la section <em>Sous-traitants</em> ci-dessous, où chaque
            destinataire indique précisément les données qu’il traite et pour quelle finalité.
          </p>
        </Section>

        <Section title="3. Base légale du traitement">
          <p>
            Le traitement de vos données repose sur l’une des bases légales prévues à
            l’article 6 du RGPD selon le contexte : exécution d’un contrat,
            intérêt légitime, consentement, ou obligation légale.
          </p>
        </Section>

        <Section title="4. Sous-traitants et destinataires">
          <p>
            Pour vous fournir ce service, nous faisons appel à des sous-traitants tiers. Chaque
            sous-traitant ne traite que les données strictement nécessaires à sa mission, dans le
            cadre d’un contrat conforme à l’article 28 du RGPD.
          </p>

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
                    {sp.isEUResident ? "UE" : "Hors UE"}
                  </span>
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[10rem_1fr] sm:gap-x-4">
                  <dt className="font-medium">Finalité</dt>
                  <dd>{sp.purpose}</dd>

                  <dt className="font-medium">Données traitées</dt>
                  <dd>
                    <ul className="list-disc pl-5">
                      {sp.dataTypes.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </dd>

                  <dt className="font-medium">Conservation</dt>
                  <dd>{sp.retention}</dd>

                  <dt className="font-medium">Base légale</dt>
                  <dd>{sp.legalBasis}</dd>

                  {sp.transferMechanism ? (
                    <>
                      <dt className="font-medium">Transfert / précisions</dt>
                      <dd>{sp.transferMechanism}</dd>
                    </>
                  ) : null}

                  <dt className="font-medium">En savoir plus</dt>
                  <dd className="flex flex-wrap gap-x-4 gap-y-1">
                    <a
                      href={sp.privacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      Politique de confidentialité
                    </a>
                    {sp.dpaUrl ? (
                      <a
                        href={sp.dpaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        Accord de traitement des données (DPA)
                      </a>
                    ) : null}
                  </dd>
                </dl>
              </div>
            ))}
          </div>
        </Section>

        <Section title="5. Vos droits">
          <p>Conformément au RGPD, vous disposez des droits suivants sur vos données :</p>
          <ul className="ml-5 list-disc space-y-1">
            <li>Droit d’accès et de rectification</li>
            <li>Droit à l’effacement (droit à l’oubli)</li>
            <li>Droit à la portabilité de vos données</li>
            <li>Droit d’opposition et de limitation du traitement</li>
            <li>
              Droit de retirer votre consentement à tout moment (lorsque le traitement est basé sur
              le consentement)
            </li>
            <li>
              Droit de déposer une plainte auprès de la CNIL (
              <a
                href="https://www.cnil.fr"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                cnil.fr
              </a>
              )
            </li>
          </ul>
          <p>
            Pour exercer vos droits :{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-2">
              {CONTACT_EMAIL}
            </a>
            . Nous nous engageons à répondre dans un délai maximal d’un mois.
          </p>
        </Section>

        <Section title="6. Cookies">
          <p>
            Ce site utilise par défaut uniquement les cookies strictement nécessaires à son
            fonctionnement (session, préférences). Aucun cookie publicitaire ou de profilage
            n’est déposé sans votre consentement explicite.
          </p>
          <p>
            Si une fonctionnalité d’analyse d’audience nécessitant un consentement est
            activée (par exemple Google Analytics), un bandeau de consentement s’affiche avant
            tout dépôt de cookie non-essentiel.
          </p>
        </Section>

        <Section title="7. Modifications">
          <p>
            Cette politique peut être mise à jour pour refléter l’évolution des services et
            des sous-traitants utilisés. La date de dernière mise à jour est indiquée en haut de
            cette page. Les modifications substantielles seront notifiées par email aux titulaires
            d’un compte utilisateur.
          </p>
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
