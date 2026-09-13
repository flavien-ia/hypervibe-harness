#!/usr/bin/env node
/**
 * Recette du pré-contrôle de `db:push` (scripts/neon/schema-drift.mjs).
 *
 * Aucun accès réseau : la sortie de `drizzle-kit export` et le catalogue de la
 * base sont injectés. Les cas viennent de défauts réels : une colonne créée en
 * base hors du code (studio-entremondes, 2026-08-30) que le push allait
 * supprimer, un tablesFilter qui ne couvrait pas les tables du schéma
 * (hypermedia-cockpit, 2026-09-11), et `numeric(6, 2)` contre `numeric(6,2)`,
 * fausse alerte du premier essai sur une vraie base.
 *
 * Plus une lecture des sources : les scripts qui poussent en --force passent
 * tous par le contrôle avant.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compare, normalizeType, parseExport, readFilters, tableMatches } from "../neon/schema-drift.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let echecs = 0;
let total = 0;
const verifier = (nom, condition, detail = "") => {
  total += 1;
  if (condition) console.log(`  ok   ${nom}`);
  else {
    echecs += 1;
    console.log(`  FAIL ${nom}${detail ? ` : ${detail}` : ""}`);
  }
};

const EXPORT = `CREATE TYPE "public"."user_role" AS ENUM('member', 'admin');
CREATE TABLE "app_user" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"roles" "public"."user_role"[] DEFAULT '{member}'::user_role[] NOT NULL,
	"score" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);

CREATE TABLE "app_post" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_id" integer NOT NULL,
	"title" text NOT NULL
);

CREATE TABLE "billing"."invoice" (
	"id" bigserial PRIMARY KEY NOT NULL
);
ALTER TABLE "app_post" ADD CONSTRAINT "app_post_author_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id");`;

console.log("parseExport");
const tables = parseExport(EXPORT);
verifier("trois tables lues, schéma qualifié compris", tables.length === 3 && tables[2].schema === "billing" && tables[2].table === "invoice");
const user = tables[0];
verifier("les contraintes ne sont pas prises pour des colonnes", user.columns.map((c) => c.name).join() === "id,email,roles,score,created_at,seen_at");
verifier("type enum tableau lu", user.columns[2].type === '"public"."user_role"[]');
verifier("NOT NULL et DEFAULT repérés", user.columns[1].notNull && !user.columns[1].hasDefault && user.columns[4].hasDefault);
verifier("serial compte comme ayant une valeur par défaut", user.columns[0].hasDefault);

console.log("\nnormalizeType");
const paires = [
  ["serial", "integer"],
  ["varchar(255)", "character varying(255)"],
  ["numeric(6, 2)", "numeric(6,2)"],
  ["timestamp", "timestamp without time zone"],
  ["timestamp(3)", "timestamp(3) without time zone"],
  ["timestamp with time zone", "timestamp with time zone"],
  ['"public"."user_role"[]', "user_role[]"],
  ["bigserial", "bigint"],
  ["boolean", "boolean"],
];
for (const [kit, pg] of paires) verifier(`${kit} = ${pg}`, normalizeType(kit) === normalizeType(pg), `${normalizeType(kit)} / ${normalizeType(pg)}`);
verifier("text et varchar restent différents", normalizeType("text") !== normalizeType("varchar(40)"));

console.log("\nfiltres");
verifier("tablesFilter tableau", JSON.stringify(readFilters(`tablesFilter: ["app_*"],`).tables) === '["app_*"]');
verifier("tablesFilter chaîne simple", JSON.stringify(readFilters(`tablesFilter: 'app_*'`).tables) === '["app_*"]');
verifier("schemaFilter lu", JSON.stringify(readFilters(`schemaFilter: ["public", "billing"]`).schemas) === '["public","billing"]');
verifier("schemaFilter par défaut = public", JSON.stringify(readFilters("").schemas) === '["public"]');
verifier("filtre calculé signalé illisible", readFilters("tablesFilter: [`${prefix}_*`]").unreadable.includes("tablesFilter"));
verifier("filtre venant d'une variable signalé illisible", readFilters("tablesFilter: FILTRES,").unreadable.includes("tablesFilter"));
verifier("glob positif", tableMatches("app_user", ["app_*"]) && !tableMatches("other_user", ["app_*"]));
verifier("glob négatif", !tableMatches("app_secret", ["app_*", "!app_secret"]));
verifier("sans filtre tout passe", tableMatches("anything", null));

const L = (schema, table, column, type) => ({ schema, table, column, type });
const baseLive = [
  L("public", "app_user", "id", "integer"),
  L("public", "app_user", "email", "character varying(255)"),
  L("public", "app_user", "roles", "user_role[]"),
  L("public", "app_user", "score", "numeric(6,2)"),
  L("public", "app_user", "created_at", "timestamp with time zone"),
  L("public", "app_user", "seen_at", "timestamp without time zone"),
  L("public", "app_post", "id", "integer"),
  L("public", "app_post", "author_id", "integer"),
  L("public", "app_post", "title", "text"),
  L("billing", "invoice", "id", "bigint"),
];
const F = { tables: ["app_*", "invoice"], schemas: ["public", "billing"], unreadable: [] };

console.log("\ncompare");
let r = compare(tables, baseLive, F);
verifier("base alignée : rien à signaler", !r.dataLoss && !r.warnings, JSON.stringify(r));

r = compare(tables, [...baseLive, L("public", "app_user", "api_token", "text")], F);
verifier("colonne en base absente du schéma = perte", r.dataLoss && r.droppedColumns[0] === "public.app_user.api_token");

r = compare(tables, [...baseLive, L("public", "app_legacy", "id", "integer")], F);
verifier("table dans le filtre absente du schéma = perte", r.dataLoss && r.droppedTables[0] === "public.app_legacy");

r = compare(tables, [...baseLive, L("public", "other_app_table", "id", "integer")], F);
verifier("table hors filtre : push ne la touche pas", !r.dataLoss);

r = compare(tables, [...baseLive, L("public", "app_legacy", "id", "integer")], { ...F, unreadable: ["tablesFilter"] });
verifier("filtre illisible : pas de perte annoncée à tort, mais un avertissement", !r.dataLoss && r.warnings);

const sansTitre = baseLive.filter((x) => !(x.table === "app_post" && x.column === "title"));
r = compare(tables, sansTitre, F, new Set(["public.app_post"]));
verifier("NOT NULL sans défaut sur table peuplée = troncature", r.dataLoss && r.truncatedTables[0]?.column === "title");
r = compare(tables, sansTitre, F, new Set());
verifier("la même colonne sur table vide = simple ajout", !r.dataLoss && r.addedColumns[0] === "public.app_post.title");

r = compare(tables, baseLive.map((x) => (x.column === "title" ? { ...x, type: "character varying(40)" } : x)), F);
verifier("changement de type = avertissement, pas perte", !r.dataLoss && r.typeChanges.length === 1);

r = compare(tables, baseLive, { ...F, tables: ["hm_*"] });
verifier("tables du schéma hors du filtre signalées", r.outsideFilter.length === 3 && r.outsideFilter.includes("public.app_user"));

r = compare(tables, [], F);
verifier("base neuve : tout est ajout", !r.dataLoss && r.addedTables.length === 3);

console.log("\nbranchement dans les scripts qui poussent");
for (const f of ["setup-db.mjs", "setup-auth-users.mjs", "setup-role.mjs", "setup-agent.mjs"]) {
  const src = readFileSync(join(RACINE, "scripts", f), "utf8");
  const iCheck = src.indexOf("checkBeforeForcePush({");
  const iPush = src.search(/drizzle-kit push --force"|run\("pnpm db:push"/);
  verifier(`${f} contrôle avant de pousser`, iCheck > 0 && iPush > iCheck);
  if (src.includes('push --force"')) verifier(`${f} ne passe --force que si le contrôle l'autorise`, /drift\.allowForce\s*&&/.test(src));
}

console.log(`\n${total - echecs}/${total} vérifications passent`);
if (echecs) process.exit(1);
