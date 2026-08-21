#!/usr/bin/env node
// test-security-claims.mjs - SECURITY.md makes promises. This checks they hold.
//
// A security page is a claim about the code, and a claim nobody verifies rots
// silently: the day someone adds a `package.json` to the plugin, the sentence
// "no package.json, so no dependencies and no install script" becomes false and
// nothing says so. Worse than having no page at all, because people acted on it.
//
// So each factual claim of SECURITY.md is asserted here, and this suite runs
// before every release. When a claim legitimately changes, the fix is to change
// BOTH the page and the assertion, in the same commit.
//
//   node scripts/tests/test-security-claims.mjs

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

const lire = (p) => readFileSync(join(ROOT, p), "utf8");
const securite = lire("SECURITY.md");

/** Tous les fichiers du plugin, hors dossiers de travail. */
function fichiers(dir = ROOT, acc = []) {
  for (const nom of readdirSync(dir)) {
    if (nom === ".git" || nom === "node_modules") continue;
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) fichiers(p, acc);
    else acc.push(p);
  }
  return acc;
}
const tous = fichiers();

// ── « Text only, and that is enforced at publication » ───────────────
{
  // Le controle de publication vit sur la plateforme ; ce qui se verifie ici,
  // c'est la moitie qui depend du plugin : aucun fichier binaire livre.
  const binaires = tous.filter((p) => {
    const buf = readFileSync(p);
    if (buf.includes(0)) return true; // octet nul = binaire
    // Aller-retour UTF-8 : si decoder puis re-encoder ne redonne pas les memes
    // octets, le fichier n'est pas du texte valide. Chercher le caractere de
    // remplacement dans le contenu, en revanche, ferait echouer ce fichier-ci
    // des qu'il le mentionne : c'est arrive du premier coup.
    return Buffer.compare(Buffer.from(buf.toString("utf8"), "utf8"), buf) !== 0;
  });
  check(
    "aucun fichier binaire dans le plugin (le zip est 100 % texte)",
    binaires.length === 0,
    binaires.map((p) => relative(ROOT, p)).slice(0, 3).join(", "),
  );
}

// ── « No package.json, so no dependencies and no install script » ────
check(
  "aucun package.json a la racine du plugin",
  !existsSync(join(ROOT, "package.json")),
);
check(
  "aucun package.json nulle part dans le plugin (hors gabarits livres au projet)",
  tous.filter(
    (p) => p.endsWith("package.json") && !relative(ROOT, p).startsWith("templates"),
  ).length === 0,
);

// ── « Each skill declares the tools it may use » ─────────────────────
{
  const skills = readdirSync(join(ROOT, "skills")).filter((d) =>
    existsSync(join(ROOT, "skills", d, "SKILL.md")),
  );
  // Front-matter bien forme : c'est ce qui rend une skill lisible et auditable
  // avant de l'executer.
  const malForme = skills.filter((d) => {
    const s = lire(`skills/${d}/SKILL.md`);
    return !/^name:\s*\S/m.test(s) || !/^description:\s*\S/m.test(s);
  });
  check(
    `les ${skills.length} skills ont un front-matter nomme et decrit`,
    malForme.length === 0,
    malForme.slice(0, 3).join(", "),
  );
  const avec = skills.filter((d) => /^allowed-tools:/m.test(lire(`skills/${d}/SKILL.md`)));
  console.log(`     (dont ${avec.length} restreignent explicitement leurs outils)`);
}

// ── « The plugin never grants itself permissions » ───────────────────
{
  const coupables = tous.filter((p) => {
    if (!/\.(mjs|js|md)$/.test(p)) return false;
    // Ce fichier-ci parle forcement de settings.json : c'est son sujet.
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    if (rel.startsWith("scripts/tests/")) return false;
    return /settings\.local\.json|\.claude\/settings\.json/.test(readFileSync(p, "utf8"));
  });
  check(
    "le plugin n'ecrit jamais dans settings.json (aucune permission auto-octroyee)",
    coupables.length === 0,
    coupables.map((p) => relative(ROOT, p)).slice(0, 3).join(", "),
  );
}

// ── « One MCP server, context7, over HTTP » ──────────────────────────
{
  const mcp = JSON.parse(lire(".mcp.json"));
  const noms = Object.keys(mcp.mcpServers ?? {});
  check("un seul serveur MCP declare", noms.length === 1, noms.join(", "));
  const s = mcp.mcpServers[noms[0]];
  check(
    "ce serveur est context7, en HTTP (rien d'installe localement)",
    noms[0] === "context7" && s.type === "http" && /^https:\/\//.test(s.url ?? ""),
    `${s.type} ${s.url}`,
  );
  check(
    "aucun serveur MCP ne lance de commande locale",
    !("command" in s) && !("args" in s),
  );
}

// ── « A PreToolUse hook refuses / asks » ─────────────────────────────
{
  const h = JSON.parse(lire("hooks/hooks.json"));
  const pre = h.hooks?.PreToolUse ?? [];
  check("un hook PreToolUse est declare", pre.length >= 1);
  check(
    "il ne cible que Bash",
    pre.every((e) => e.matcher === "Bash"),
    pre.map((e) => e.matcher).join(", "),
  );
  check(
    "il pointe sur guard-bash.mjs via CLAUDE_PLUGIN_ROOT",
    JSON.stringify(pre).includes("guard-bash.mjs") &&
      JSON.stringify(pre).includes("CLAUDE_PLUGIN_ROOT"),
  );
}

// ── « Fail-open » ────────────────────────────────────────────────────
{
  const g = lire("hooks/guard-bash.mjs");
  check(
    "le hook laisse passer quand il ne peut pas decider (fail-open)",
    /catch \(e\)/.test(g) && /process\.exit\(0\)/.test(g) && /FAIL-OPEN/i.test(g),
  );
}

// ── « The scripts carry their own checks » ───────────────────────────
{
  const sql = lire("scripts/neon/run-sql.mjs");
  check(
    "run-sql.mjs refuse le SQL destructeur sans --destructif",
    /--destructif/.test(sql) && /statementsDestructrices/.test(sql),
  );
  const del = lire("scripts/delete-project/execute-deletions.mjs");
  check(
    "execute-deletions.mjs exige --confirm <projet>",
    /--confirm/.test(del) && /process\.exit\(7\)/.test(del),
  );
}

// ── « Both directions are tested » ───────────────────────────────────
check(
  "la recette des garde-fous existe et teste les deux sens",
  existsSync(join(ROOT, "hooks/test-hooks.mjs")) &&
    /Laisse passer/.test(lire("hooks/test-hooks.mjs")),
);

// ── « Empty by default » (les deux barrieres de l'agent genere) ──────
{
  const setup = lire("scripts/setup-agent.mjs");
  check(
    "l'agent genere ne peut ecrire nulle part par defaut",
    /mailAllowlist: ""/.test(setup) && /fetchWriteHosts: ""/.test(setup),
  );
  const mail = lire("templates/agent/tools/send-email.ts");
  check(
    "liste de destinataires vide = aucun envoi",
    /list\.length === 0/.test(mail),
  );
}

// ── « Secrets: vault, never in the chat » ────────────────────────────
check(
  "les outils du coffre sont livres",
  existsSync(join(ROOT, "scripts/vault/vault.mjs")) &&
    existsSync(join(ROOT, "scripts/vault/launch.mjs")),
);

// ── « /update-hypervibe verifies the fingerprint » ───────────────────
{
  const up = lire("scripts/update/update-hypervibe.mjs");
  check(
    "la mise a jour refuse d'installer si l'empreinte ne correspond pas",
    /sha256-mismatch/.test(up) && /api\/plugin\/current/.test(up),
  );
  // Le manifeste est mis en cache : juste apres une publication il peut encore
  // annoncer la version precedente, dont l'empreinte differe legitimement de
  // l'archive fraichement telechargee. Sans cette garde, la verification
  // refusait une mise a jour valide (constate a la publication de la 2.9.0).
  check(
    "elle ne compare que si le manifeste decrit la version telechargee",
    /j\.version === version/.test(up),
  );
}

// ── La page dit ce qu'elle promet (garde contre une page videe) ──────
{
  const attendus = [
    "AGENT_MAIL_ALLOWLIST",
    "AGENT_FETCH_WRITE_HOSTS",
    "Fail-open",
    "SHA-256",
    "allowed-tools",
    "settings.json",
    "context7",
  ];
  const absents = attendus.filter((m) => !securite.includes(m));
  check(
    "SECURITY.md mentionne toujours les mecanismes verifies ici",
    absents.length === 0,
    absents.join(", "),
  );
  check(
    "SECURITY.md enonce la limite de l'empreinte (meme origine)",
    /not that the site is honest|pas que le site/i.test(securite) ||
      /transfer was intact/.test(securite),
  );
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
