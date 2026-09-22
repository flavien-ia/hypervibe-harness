#!/usr/bin/env node
// test-run-sql.mjs - Recette of scripts/neon/run-sql.mjs: what it refuses, and where it
// agrees to send a connection string.
//
// Nothing here reaches a network or a database: the functions are called directly, and the
// script is only ever launched on inputs it must refuse BEFORE connecting.
//
//   node scripts/tests/test-run-sql.mjs

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "neon", "run-sql.mjs");
const { statementsDestructrices, hoteDuFournisseur, splitStatements } = await import(pathToFileURL(SCRIPT).href);

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${detail})`}`);
}
const refuse = (sql) => statementsDestructrices(sql).length > 0;

console.log("── Tout DROP est destructeur, quel que soit l'objet ──");
for (const sql of [
  "DROP TABLE clients",
  "DROP TABLE IF EXISTS clients CASCADE",
  "DROP TYPE humeur",
  "DROP INDEX idx_clients_email",
  "DROP VIEW v_ventes",
  "DROP MATERIALIZED VIEW mv_ventes",
  "DROP FUNCTION purge()",
  "DROP TRIGGER maj ON clients",
  "DROP POLICY lecture ON clients",
  "DROP SEQUENCE clients_id_seq",
  "DROP EXTENSION vector",
  "DROP SCHEMA public CASCADE",
  "DROP ROLE lecteur",
  "drop   table\n clients",
  "ALTER TABLE t DROP COLUMN email",
  "ALTER TABLE t DROP CONSTRAINT t_pkey",
  "TRUNCATE hypervibe_order",
]) check(`refuse : ${sql.replace(/\s+/g, " ")}`, refuse(sql));

console.log("\n── Un WHERE qui ne borne rien vaut une absence de WHERE ──");
check("DELETE sans WHERE", refuse("DELETE FROM sessions"));
check("DELETE ... WHERE true", refuse("DELETE FROM sessions WHERE true"));
check("DELETE ... WHERE 1=1", refuse("DELETE FROM sessions WHERE 1 = 1"));
check("DELETE ... WHERE 'a'='a'", refuse("DELETE FROM sessions WHERE 'a'='a'"));
check("DELETE ... WHERE true RETURNING id", refuse("DELETE FROM sessions WHERE true RETURNING id"));
check("UPDATE sans WHERE", refuse("UPDATE users SET active = false"));
check("UPDATE ... WHERE TRUE", refuse("UPDATE users SET active = false WHERE TRUE"));
check("passe : DELETE borne", !refuse("DELETE FROM sessions WHERE expires_at < now()"));
check("passe : WHERE true AND id = 3", !refuse("DELETE FROM sessions WHERE true AND id = 3"));
check("passe : UPDATE borne", !refuse("UPDATE users SET active = false WHERE id = 3"));
check("passe : colonne true_flag", !refuse("UPDATE users SET a = 1 WHERE true_flag = 1"));
check("passe : un upsert (ON CONFLICT DO UPDATE) ne reecrit que la ligne en conflit", !refuse("INSERT INTO t (a, b) VALUES (1, 2) ON CONFLICT (a) DO UPDATE SET b = 2, updated_at = now()"));
check("passe : un MERGE ne reecrit que les lignes appariees", !refuse("MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET b = s.b"));
check("refuse encore : un UPDATE nu apres un upsert", refuse("INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET b = 2; UPDATE t SET c = 3"));

console.log("\n── Un bloc DO s'execute tout de suite : son SQL dynamique est relu, ou refuse ──");
check("DO ... EXECUTE 'DROP TABLE'", refuse("DO $$ BEGIN EXECUTE 'DROP TABLE clients'; END $$"));
check("DO ... EXECUTE 'TRUNCATE'", refuse("DO $do$ BEGIN EXECUTE 'TRUNCATE clients'; END $do$"));
check("DO ... DROP en clair", refuse("DO $$ BEGIN DROP TABLE clients; END $$"));
check(
  "DO ... EXECUTE d'un SQL fabrique a l'execution : refuse faute de voir",
  refuse("DO $$ BEGIN EXECUTE 'DR' || 'OP TABLE clients'; END $$"),
);
check(
  "DO ... EXECUTE format(...) : refuse faute de voir",
  refuse("DO $$ BEGIN EXECUTE format('ALTER TABLE %I ADD COLUMN a int', 't'); END $$"),
);
check("passe : DO sans SQL dynamique", !refuse("DO $$ BEGIN PERFORM 1; END $$"));
check(
  "passe : CREATE TRIGGER ... EXECUTE FUNCTION",
  !refuse("CREATE TRIGGER maj BEFORE UPDATE ON t FOR EACH ROW EXECUTE FUNCTION touch()"),
);

console.log("\n── Ce qui ressemble a du destructeur sans en etre ──");
check("passe : INSERT d'une chaine 'DROP TABLE'", !refuse("INSERT INTO log (m) VALUES ('DROP TABLE clients')"));
check("passe : commentaire -- DROP TABLE", !refuse("SELECT 1 -- DROP TABLE clients"));
check("passe : colonne dropped_at", !refuse("SELECT dropped_at FROM imports"));
check("passe : CREATE INDEX", !refuse("CREATE INDEX i ON t (a)"));
check("passe : CREATE TABLE", !refuse("CREATE TABLE t (id int)"));
check(
  "un lot : le DELETE borne passe, le DELETE nu qui le suit est vu",
  refuse("DELETE FROM t WHERE id = 1; DELETE FROM t") && !refuse("DELETE FROM t WHERE id = 1; SELECT 1"),
);
check("le decoupage garde un bloc DO entier", splitStatements("DO $$ BEGIN PERFORM 1; PERFORM 2; END $$; SELECT 1").length === 2);

console.log("\n── La chaine de connexion ne part que chez le fournisseur ──");
for (const host of [
  "ep-cool-darkness-123456.eu-central-1.aws.neon.tech",
  "ep-cool-darkness-123456-pooler.eu-central-1.aws.neon.tech",
  "ep-late-sun-1.eastus2.azure.neon.tech",
  "EP-UPPER.eu-central-1.aws.NEON.TECH",
]) check(`accepte : ${host}`, hoteDuFournisseur(host));
for (const host of [
  "db.exemple.fr",
  "localhost",
  "127.0.0.1",
  "neon.tech.exemple.fr",
  "exemple-neon.tech",
  "aws-0-eu-central-1.pooler.supabase.com",
  "",
  undefined,
]) check(`refuse : ${String(host) || "(vide)"}`, !hoteDuFournisseur(host));

function lance(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: "", ...env },
  });
}

{
  const SECRET = "motdepasse-qui-ne-doit-jamais-sortir";
  const r = lance(["SELECT 1"], { DATABASE_URL: `postgres://app:${SECRET}@db.exemple.fr:5432/app` });
  check("un hote etranger est refuse avant tout envoi (exit 1)", r.status === 1, `exit ${r.status}`);
  check("le refus nomme l'hote", /db\.exemple\.fr/.test(r.stderr));
  check("le refus ne montre jamais la chaine ni son mot de passe", !(r.stdout + r.stderr).includes(SECRET));
}
{
  const r = lance(["DROP TYPE humeur"]);
  check("DROP TYPE sans drapeau : exit 6, avant toute connexion", r.status === 6, `exit ${r.status}`);
  check("le message annonce la confirmation a venir", /--destructif/.test(r.stderr));
}
{
  const r = lance(["DO $$ BEGIN EXECUTE 'DROP TABLE clients'; END $$"]);
  check("bloc DO avec DROP dynamique sans drapeau : exit 6", r.status === 6, `exit ${r.status}`);
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
