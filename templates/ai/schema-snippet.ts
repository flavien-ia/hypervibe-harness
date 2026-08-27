// ─── Journal des appels d'IA ─────────────────────────────────────────────────
// À coller dans src/server/db/schema.ts, puis `pnpm db:push`.
//
// Une ligne par appel, avec le coût RÉEL renvoyé par le fournisseur. C'est ce
// qui rend la dépense visible au lieu de n'apparaître que sur une facture en
// fin de mois. `costUsd` est un entier en MILLIONIÈMES de dollar : un appel
// coûte souvent 0,0002 $, ce qu'un type monétaire à deux décimales arrondirait
// à zéro, et la somme du mois vaudrait alors zéro elle aussi.

export const aiUsage = createTable(
  "ai_usage",
  {
    id: serial("id").primaryKey(),
    /** La clé de MODELES qui a servi : "chat", "classification"... */
    usage: text("usage").notNull(),
    modele: text("modele").notNull(),
    /** Qui a déclenché l'appel. NULL = tâche de fond. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    tokensEntree: integer("tokens_entree").notNull().default(0),
    tokensSortie: integer("tokens_sortie").notNull().default(0),
    /** Millionièmes de dollar. 0,000250 $ s'écrit 250. */
    coutMicroUsd: integer("cout_micro_usd").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    // Le tableau de bord lit toujours « le mois en cours », parfois pour une
    // personne : sans cet index il balaierait toute la table à chaque fois.
    index("ai_usage_created_idx").on(t.createdAt),
    index("ai_usage_user_idx").on(t.userId),
  ],
);
