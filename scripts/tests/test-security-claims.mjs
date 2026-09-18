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

import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

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

// ── « What /start installs » ─────────────────────────────────────────
// Le plugin n'installe rien tout seul, mais /start installe beaucoup : Node,
// Git, pnpm, gitleaks, le CLI du coffre, et il touche au PATH et au git global.
// La tentation est d'ecrire « aucune dependance » et de s'arreter la : c'est
// vrai du plugin et faux de l'experience. Une page de securite qui laisse
// croire ca vaut moins que pas de page du tout, parce qu'on a agi dessus. Ces
// controles lient la section a la realite du code.
{
  // Les scripts qui vont chercher un binaire sur le reseau. La liste est
  // nommement connue : un quatrieme apparait, la page doit etre relue avant que
  // la recette repasse au vert.
  const CONNUS = [
    "scripts/setup-gitleaks-global.mjs", // gitleaks, depuis ses releases GitHub
    "scripts/vault/install-bw.mjs", // CLI Bitwarden, depuis vault.bitwarden.com
    "scripts/update/update-hypervibe.mjs", // le plugin lui-meme, verifie par empreinte
  ];
  const telechargeurs = tous
    .filter((p) => {
      const rel = relative(ROOT, p).replace(/\\/g, "/");
      if (!/\.(mjs|sh|ps1)$/.test(rel)) return false;
      if (rel.startsWith("scripts/tests/") || rel.startsWith("templates/")) return false;
      const s = readFileSync(p, "utf8");
      return /https:\/\/[^\s"'`]*(releases|\/download|install\.sh|\.msixbundle)/.test(s);
    })
    .map((p) => relative(ROOT, p).replace(/\\/g, "/"));
  const inattendus = telechargeurs.filter((p) => !CONNUS.includes(p));
  check(
    "aucun telechargement de binaire hors des scripts que la page documente",
    inattendus.length === 0,
    inattendus.join(", "),
  );

  const section = /##\s+What `\/start` installs\n([\s\S]*?)(?=\n## )/.exec(securite)?.[1] ?? "";
  check("SECURITY.md dit ce que /start installe", section.length > 400);
  for (const attendu of ["gitleaks", "Bitwarden", "Node.js", "PATH", "core.hooksPath"]) {
    check(`cette section nomme ${attendu}`, section.includes(attendu), `${section.length} car.`);
  }
  check(
    "la section distingue ce qui s'installe sans demander de ce qui attend un accord",
    /without asking/.test(section) && /after you agree/.test(section),
  );
  // La formule exacte qui etait fausse : le plugin ne se sert PAS seulement
  // d'outils deja presents, il les installe.
  check(
    "la page ne pretend plus se servir uniquement d'outils deja presents",
    !/CLIs you already have/.test(securite),
  );
}

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
    "il cible Bash et Monitor, les deux outils qui executent un shell",
    pre.every((e) => e.matcher === "Bash|Monitor"),
    pre.map((e) => e.matcher).join(", "),
  );
  check(
    "guard-bash.mjs accepte les deux outils",
    /SHELL_TOOLS = new Set\(\["Bash", "Monitor"\]\)/.test(lire("hooks/guard-bash.mjs")),
  );
  check(
    "les regles ne voient jamais la tete brute d'une commande (normalise)",
    /function normalise\(/.test(lire("hooks/rules.mjs")) && /raw head of a command/.test(securite),
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
  // Revue du lot stockage (18/09/2026) : une ressource partagee restait dans l'inventaire
  // des qu'elle n'etait pas un worker, et la sauvegarde d'avant suppression sautait le
  // stockage en silence des que les cles manquaient dans le .env local.
  check(
    "discover-resources.mjs retire de la suppression toute ressource declaree partagee, pas seulement un worker",
    /excludeShared\(\{ workers, r2, neon, render, stripe \}, r\)/.test(lire("scripts/delete-project/discover-resources.mjs")),
  );
  check(
    "la sauvegarde d'avant suppression ne saute le stockage que sur un refus explicite",
    /--skip-storage ONLY if the user explicitly answered/.test(lire("skills/delete-project/SKILL.md")) &&
      !/go straight to running the script with `--skip-storage`/.test(lire("skills/delete-project/SKILL.md")),
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

// ── Ce que les telechargeurs verifient (revue externe, 2.9.5) ────────
{
  const gl = lire("scripts/setup-gitleaks-global.mjs");
  check(
    "gitleaks : l'archive est comparee au checksums.txt de la meme release",
    /_checksums\\.txt/.test(gl) && /createHash\("sha256"\)/.test(gl) && /Checksum mismatch/.test(gl),
  );
  const bw = lire("scripts/vault/install-bw.mjs");
  check(
    "Bitwarden : la redirection est resolue a la main et bornee a la release officielle",
    /redirect: "manual"/.test(bw) && /github\.com\/bitwarden\/clients\/releases\/download\//.test(bw),
  );
}

// ── Le refus ne nomme pas son propre contournement ───────────────────
{
  // Les prefixes d'exception restent lus par le hook (un `env.get` chacun),
  // mais leur nom ne figure dans aucune raison rendue au modele : un refus qui
  // nomme son contournement est contourne par son lecteur.
  //
  // Le controle porte sur l'EMPLACEMENT, pas sur le nombre : compter les
  // occurrences etait un proxy qui tenait tant qu'il y avait exactement deux
  // echappatoires, et qui a casse le jour ou une troisieme, legitime et testee,
  // est arrivee (ALLOW_DB_PUSH, 9 septembre 2026). Un garde-fou qui refuse une
  // extension legitime de ce qu'il protege finit par etre desactive.
  const r = lire("hooks/rules.mjs");
  const mentions = r.match(/HYPERVIBE_GUARD_ALLOW_[A-Z_]+/g) ?? [];
  // Deux lectures possibles : la commande (`env.get`, les prefixes tapes) et
  // l'environnement de la session (`process.env`, pose par un humain avant de
  // lancer Claude Code, la seule forme de l'exception du schema depuis 3.1.5).
  const lectures = r.match(/(?:env\.get\("|process\.env\.)HYPERVIBE_GUARD_ALLOW_[A-Z_]+/g) ?? [];
  check(
    "rules.mjs ne cite les prefixes ALLOW_* que pour les lire, jamais dans une raison",
    mentions.length > 0 && mentions.length === lectures.length,
    `${mentions.length} mention(s) pour ${lectures.length} lecture(s)`,
  );
  check(
    "l'exception du schema vient de l'environnement de la session, jamais de la commande",
    /process\.env\.HYPERVIBE_GUARD_ALLOW_DB_PUSH === "1"/.test(r) && !/env\.get\("HYPERVIBE_GUARD_ALLOW_DB_PUSH"\)/.test(r),
  );
}

// ── Aucun fichier de secrets ecrit dans l'arbre de travail ───────────
{
  const cd = lire("scripts/check-deps.mjs");
  check(
    "check-deps ecrit l'env Vercel dans le dossier temporaire du systeme, jamais dans le depot",
    /tmpdir\(\)/.test(cd) && !/\.env\.vercel\.check-deps\.tmp/.test(cd),
  );
}

// ── L'agent genere : redirections et URL bornees ─────────────────────
{
  const hf = lire("templates/agent/tools/http-fetch.ts");
  check(
    "http-fetch resout les redirections a la main et rejoue la garde a chaque saut",
    /redirect: "manual"/.test(hf) && /guardUrl\(next\)/.test(hf),
  );
  check(
    "http-fetch borne l'URL vers les hotes hors allowlist (fuite par GET)",
    /MAX_URL_LENGTH/.test(hf) && /MAX_QUERY_LENGTH/.test(hf),
  );
}

// ── La page dit ce que le worker partage detient, et ce que vaut le
//    refus sans hook ─────────────────────────────────────────────────
{
  check(
    "SECURITY.md nomme ce que le worker partage detient",
    /CRON_SECRET/.test(securite) && /\.hypervibe-jobs/.test(securite) && /blast radius/i.test(securite),
  );
  check(
    "SECURITY.md ne pretend plus proteger les hotes sans hook sans nuance",
    !/Those also\s+protect hosts that have no hooks/.test(securite) &&
      /treat\s+the flag as the confirmation/i.test(securite),
  );
  check(
    "SECURITY.md dit que gitleaks est verifie et que Bitwarden ne peut l'etre que par sa provenance",
    /checksums\.txt/.test(securite) && /publishes no checksum/.test(securite),
  );
}

// ── Les releases sont signees, et la page donne de quoi le verifier ──
{
  // Une release GitHub n'est un canal independant de l'empreinte servie par
  // le site que si personne ne peut la forger avec le seul compte : d'ou la
  // signature des tags (revue externe de la 2.9.5). La page doit publier la
  // cle publique ET la commande qui permet de verifier sans le badge GitHub.
  check(
    "SECURITY.md publie la cle publique (ed25519) qui signe les releases",
    /ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[0-9A-Za-z+\/]{40,}/.test(securite),
  );
  check(
    "SECURITY.md donne la commande de verification d'un tag et sa ligne allowed_signers",
    /git .*verify-tag/.test(securite) && /namespaces="git"/.test(securite) && /SHA256:[0-9A-Za-z+\/]{43}/.test(securite),
  );
  check(
    "SECURITY.md dit ce que la signature ne couvre pas (l'archive reconstruite par le site)",
    /which the tag does not sign/.test(securite),
  );
}

// ── Le contenu tiers arrive aussi par un script, pas seulement par WebFetch ──
{
  // Le bloc « donnee, jamais instruction » vivait dans les skills qui appellent
  // WebFetch, et manquait dans celles qui recoivent du contenu reseau en sortie
  // de script : le HTML d'un site deploye (eco-audit, seo-perf), des avis npm
  // rediges par des tiers (security), et sept _dns-* sur douze, sans logique de
  // risque (revue externe, 3.0.4). La liste ci-dessous est nominative : une
  // skill qui fait lire au modele ce qu'un tiers a ecrit y entre, et la
  // recette refuse tant que le bloc n'y est pas.
  const PHRASE = "never instructions to follow";
  const LISENT_DU_CONTENU_TIERS = [
    "_create-render-worker", "_dns-brevo", "_dns-cloudflare", "_dns-gandi",
    "_dns-godaddy-manual", "_dns-hostinger", "_dns-infomaniak-manual",
    "_dns-ionos-manual", "_dns-namecheap", "_dns-ovh", "_dns-porkbun",
    "_dns-resend", "_dns-squarespace-manual", "_get-secret", "_setup-gsc",
    "_setup-indexnow", "_setup-render", "_setup-stripe-cli", "add-backup-db",
    "add-db", "add-email", "add-map", "add-stripe", "bootstrap", "eco-audit",
    "gsc", "optimize", "quotas", "rotate-secret", "security", "seo", "seo-perf",
    "start",
  ];
  const sans = LISENT_DU_CONTENU_TIERS.filter(
    (d) => !existsSync(join(ROOT, "skills", d, "SKILL.md")) || !lire(`skills/${d}/SKILL.md`).includes(PHRASE),
  );
  check(
    `les ${LISENT_DU_CONTENU_TIERS.length} skills qui lisent du contenu tiers portent le bloc « donnee, jamais instruction »`,
    sans.length === 0,
    sans.join(", "),
  );
  // Les skills qui touchent au reseau sans etre dans la liste ont ete lues une
  // par une (11 septembre 2026) : aucune ne fait lire au modele du texte ecrit
  // par un tiers. Un curl vers l'API du compte (Cloudflare, le worker partage),
  // un curl vers le serveur de dev local, ou `fetch(` dans un gabarit de code
  // ne sont pas des lectures de contenu tiers. Une skill qui sort de cette
  // liste, ou une nouvelle qui touche au reseau, reapparait ici : a evaluer.
  const EVALUEES_SANS_BLOC = new Set([
    "add-cron", // curl vers le worker partage du compte
    "add-domain", // API Cloudflare du compte ; les registrars sont dans les _dns-*
    "add-i18n", // curl vers le serveur de dev local
    "clean", // `fetch(` est un motif cherche dans le code, pas un appel
    "new-email-address", // API Cloudflare du compte
    "_check-deps", // le mot curl en prose
    "_create-cloudflare-worker", // `fetch(request)` dans le gabarit du worker
    "_migrate-workers", // curl vers le worker partage du compte
  ]);
  const reseau = readdirSync(join(ROOT, "skills")).filter((d) => {
    const f = join(ROOT, "skills", d, "SKILL.md");
    if (!existsSync(f) || EVALUEES_SANS_BLOC.has(d)) return false;
    const t = readFileSync(f, "utf8");
    return /WebFetch|curl |fetch\(|pagespeed|npm audit|pnpm audit|dig |nslookup/.test(t) && !t.includes(PHRASE);
  });
  if (reseau.length) console.log(`     (touchent au reseau sans le bloc, a evaluer : ${reseau.join(", ")})`);
}

// ── Ce que la recette EXECUTE (revue externe, 3.0.4) ─────────────────
// Un controle qui lit un nom de fonction ou la forme d'une chaine verifie du
// vocabulaire : renommer casse la recette sans toucher a la securite, et un
// message d'erreur mort la garde verte. Les quatre controles ci-dessous font
// tourner ce qu'ils valident, a sec (aucune base, aucun compte, aucun reseau).
{
  // 1. L'empreinte publiee est CELLE de la cle publiee : recalculee ici, pas
  //    reconnue a sa forme. Une cle fausse, perimee ou d'un tiers ne passe plus.
  const cle = /ssh-ed25519 (AAAAC3NzaC1lZDI1NTE5[0-9A-Za-z+/=]+)/.exec(securite)?.[1] ?? "";
  const empreinte = cle
    ? createHash("sha256").update(Buffer.from(cle, "base64")).digest("base64").replace(/=+$/, "")
    : "";
  check(
    "l'empreinte SHA256 publiee est celle de la cle publiee (recalculee, pas reconnue a sa forme)",
    cle.length > 0 && securite.includes(`SHA256:${empreinte}`),
    empreinte ? `SHA256:${empreinte}` : "cle absente",
  );
  check(
    "la ligne allowed_signers de la page porte cette meme cle",
    cle.length > 0 && securite.includes(`namespaces="git" ssh-ed25519 ${cle}`),
  );
}
{
  // 2. run-sql.mjs refuse un DROP AVANT de chercher une base : lance sans
  //    DATABASE_URL, depuis un dossier sans .env. Le refus vaut 6 ; avec le
  //    drapeau, le garde s'efface et le script s'arrete faute de connexion (1) :
  //    la preuve que le drapeau ouvre bien le passage, et que rien n'est execute.
  const sec = spawnSync(process.execPath, [join(ROOT, "scripts/neon/run-sql.mjs"), "DROP TABLE clients"], {
    cwd: tmpdir(),
    env: { ...process.env, DATABASE_URL: "" },
    encoding: "utf8",
  });
  check(
    "run-sql.mjs refuse un DROP sans --destructif (execute, exit 6, avant toute connexion)",
    sec.status === 6 && /Refuse/.test(sec.stderr),
    `exit ${sec.status}`,
  );
  const ouvert = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/neon/run-sql.mjs"), "--destructif", "DROP TABLE clients"],
    { cwd: tmpdir(), env: { ...process.env, DATABASE_URL: "" }, encoding: "utf8" },
  );
  check(
    "avec --destructif, le garde s'efface et le script s'arrete faute de base (rien n'est execute)",
    ouvert.status === 1 && /No connection string/.test(ouvert.stderr),
    `exit ${ouvert.status}`,
  );
}
{
  // 3. execute-deletions.mjs refuse une confirmation qui ne nomme pas le projet
  //    de l'inventaire : lance sur un inventaire jetable, exit 7, rien touche.
  const dir = mkdtempSync(join(tmpdir(), "hypervibe-recette-"));
  const inventaire = join(dir, "inventory.json");
  writeFileSync(inventaire, JSON.stringify({ project: "projet-de-recette" }));
  const r = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/delete-project/execute-deletions.mjs"), "--inventory", inventaire, "--scope", '["vercel"]', "--confirm", "autre-projet"],
    { cwd: dir, encoding: "utf8" },
  );
  check(
    "execute-deletions.mjs refuse une confirmation qui ne nomme pas le projet (execute, exit 7)",
    r.status === 7 && /Refuse/.test(r.stderr),
    `exit ${r.status}`,
  );
}
{
  // 4. Fail-open, execute : une entree corrompue laisse passer (exit 0, aucune
  //    decision), et une commande interdite est bien refusee par le meme hook.
  const hook = join(ROOT, "hooks/guard-bash.mjs");
  const corrompu = spawnSync(process.execPath, [hook], { input: "ceci n'est pas du JSON", encoding: "utf8" });
  check(
    "le hook laisse passer une entree corrompue (execute : exit 0, aucune decision)",
    corrompu.status === 0 && corrompu.stdout.trim() === "",
    `exit ${corrompu.status}`,
  );
  const refus = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "git add -A" } }),
    encoding: "utf8",
  });
  check(
    "et refuse pour de vrai un `git add -A` (execute)",
    refus.status === 0 && /"permissionDecision":"deny"/.test(refus.stdout),
  );
}

// ── La procedure de release est lisible dans le depot ────────────────
{
  const release = existsSync(join(ROOT, "RELEASE.md")) ? lire("RELEASE.md") : "";
  check(
    "RELEASE.md decrit la release : recette, signature verifiee avant le push, empreinte, controle GitHub",
    /test|recipe/i.test(release) && /verify-tag/.test(release) && /SHA-256/.test(release) && /verification/.test(release),
  );
  check("SECURITY.md renvoie a RELEASE.md", /RELEASE\.md/.test(securite));
}

// ── Un clone n'execute jamais les hooks qu'il transporte ─────────────
{
  // La recette executee vit dans test-hooks-chain.mjs ; ici, la promesse de la
  // page et la forme du bloc (revue externe, 3.1.4).
  const chain = lire("scripts/ensure-hooks-chain.mjs");
  check(
    "le bloc de chainage exige l'opt-in local (git config hypervibe.hooks) avant d'executer .hooks/*",
    /TRUST_KEY = "hypervibe\.hooks"/.test(chain) && /--local --bool --get \$\{TRUST_KEY\}/.test(chain) && /never carries|never cloned/.test(chain),
  );
  check(
    "SECURITY.md dit qu'un clone n'execute jamais ses hooks sans opt-in local",
    /a clone never carries/.test(securite) && /never run/.test(securite),
  );
  check("la recette du chainage est branchee dans run-all", /test-hooks-chain\.mjs/.test(lire("scripts/tests/run-all.mjs")));
  const ci = lire("templates/tests/tests.yml");
  check(
    "le gabarit d'action GitHub reduit le jeton a la lecture et ne leve jamais la protection des scripts d'installation",
    /^permissions:\n\s+contents: read/m.test(ci) && !/approve-builds/.test(ci),
  );
}

// ── Un chemin avec un espace, un poste sans python (revue utilisateur, 3.1.5) ──
{
  const scripts = tous.filter((p) => {
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    return /\.mjs$/.test(rel) && rel.startsWith("scripts/") && !rel.startsWith("scripts/tests/");
  });
  check(
    "aucun script du plugin ne lance python",
    scripts.every((p) => !/run\("python"|spawn(?:Sync)?\("python/.test(readFileSync(p, "utf8"))),
  );
  check(
    "les scripts qui lancent des sous-processus passent par _spawn.mjs",
    ["scripts/delete-project/execute-deletions.mjs", "scripts/delete-project/discover-resources.mjs", "scripts/save-project/build-snapshot.mjs"]
      .every((f) => /from "\.\.\/_spawn\.mjs"/.test(lire(f))),
  );
  check(
    "le snapshot se replie sur les .env locaux et copie les fichiers non suivis",
    /env\/local|"local"/.test(lire("scripts/save-project/build-snapshot.mjs")) && /"untracked"/.test(lire("scripts/save-project/build-snapshot.mjs")),
  );
  check(
    "les recettes des chemins avec espace et du zip sont branchees",
    /test-spawn-paths\.mjs/.test(lire("scripts/tests/run-all.mjs")) && /test-zip\.mjs/.test(lire("scripts/tests/run-all.mjs")),
  );
}

// ── L'accord de confiance et le worker demandent ; l'index se desindexe par lien ──
{
  const r = lire("hooks/rules.mjs");
  check("le garde-fou demande avant d'ecrire hypervibe.hooks ou de lancer ensure-hooks-chain --trust", /hypervibe\\\.hooks/.test(r) && /--trust/.test(r));
  check("le garde-fou demande avant ensure.mjs / worker-check.mjs sans --dry-run", /worker-check/.test(r) && /--dry-run/.test(r));
  const chain = lire("scripts/ensure-hooks-chain.mjs");
  check("le hook n'ecrit plus la commande de l'accord dans son message", !/echo .*config \$\{TRUST_KEY\} true/.test(chain) && /a person decides/.test(chain));
  check("ensure.mjs a un --dry-run qui ne deploie rien", /flags\["dry-run"\]/.test(lire("scripts/shared-worker/ensure.mjs")));
  check(
    "la memoire se desindexe par le lien des fichiers supprimes, et l'inventaire montre ces lignes",
    /from "\.\/_memory-index\.mjs"/.test(lire("scripts/delete-project/execute-deletions.mjs")) && /indexLines/.test(lire("scripts/delete-project/discover-resources.mjs")),
  );
  check("la recette de l'index memoire est branchee", /test-memory-index\.mjs/.test(lire("scripts/tests/run-all.mjs")));
  check("check-deps signale un worker partage en retard", /sharedWorker/.test(lire("scripts/check-deps.mjs")));
}

// ── Les substitutions sont depliees, aucun rapport ne dicte l'accord (revue externe, 3.1.8) ──
{
  const r = lire("hooks/rules.mjs");
  check("rules.mjs deplie les substitutions de commande avant de juger un segment, heredocs et substitutions de processus compris", /function readCommandLine\(/.test(r) && /function readHeredocBody\(/.test(r) && /decide\(payload, env\)/.test(r));
  check("la cle de l'accord est lue sans tenir compte de la casse", /hypervibe\\\.hooks\\b\/i/.test(r));
  check("aucun script ne dicte la commande de l'accord dans un rapport", !/git config hypervibe\.hooks true/.test(lire("scripts/check-deps.mjs")));
}

// ── La page dit ce qu'elle promet (garde contre une page videe) ──────
{
  const attendus = [
    "AGENT_MAIL_ALLOWLIST",
    "AGENT_FETCH_WRITE_HOSTS",
    "Fail-open",
    "SHA-256",
    "settings.json",
    "context7",
  ];
  // `allowed-tools` a ete retire de la page : 33 des 40 skills internes le
  // declarent, et 6 des 44 publiques. La phrase se lisait comme une regle
  // generale, elle n'en etait pas une. Le controle qui tient, lui, reste :
  // le plugin n'ecrit jamais dans settings.json.
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
