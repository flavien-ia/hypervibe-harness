#!/usr/bin/env node
// test-skill-descriptions.mjs - Recette of the skill descriptions, read the way
// the upload dialog reads them.
//
// On 7 September 2026 a participant could not install the plugin through the
// "Upload a plugin" dialog of Claude Desktop: the whole zip was refused with
// "Skill 'skills/add-domain': SKILL.md description cannot contain XML tags".
// That validator (the same one behind the organisation upload in Cowork, see
// anthropics/claude-code#63081) rejects a `description` as soon as it holds a
// `<` or a `>`, arrows and placeholders included: `<Registrar> -> Cloudflare`
// was the culprit, reworded in 3.0.5. Nothing upstream warns about it:
// `claude plugin validate` only reads the manifest, and a marketplace install
// goes through. The defect therefore travels all the way to the person who
// installs, and it can come back with any new skill, which is why it is
// checked here, before every release.
//
// Only `description` is validated. `argument-hint` (`<projet>`, the Claude Code
// convention) and `compatibility` (`>=`) go through untouched and must not be
// reported, so this recette reads the frontmatter the way a YAML parser does
// instead of grepping lines: plain text on one line or continued on indented
// ones, double or single quotes (escapes and line breaks included), and the
// `|` / `>` block forms, whose indicator is not a chevron.
//
//   node scripts/tests/test-skill-descriptions.mjs          (this plugin)
//   node scripts/tests/test-skill-descriptions.mjs <dir>    (another plugin root,
//                                                            or a skills/ folder)

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOM = String.fromCharCode(0xfeff);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

// ── Reading a description the way YAML does ──────────────────────────

/** The frontmatter block of a SKILL.md, or null when the file has none. */
function frontmatterOf(content) {
  const text = content.startsWith(BOM) ? content.slice(1) : content;
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? m[1] : null;
}

/** Content of a quoted flow scalar whose opening quote is the first character
 *  of `text`. Stops at the closing quote: what follows (a comment, at most)
 *  is not part of the value. */
function quoted(text) {
  const q = text[0];
  let out = "";
  for (let i = 1; i < text.length; i += 1) {
    const c = text[i];
    if (q === '"' && c === "\\") {
      const n = text[i + 1] ?? "";
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      i += 1;
    } else if (c === q) {
      if (q === "'" && text[i + 1] === "'") {
        out += "'";
        i += 1;
      } else return out;
    } else out += c;
  }
  return out; // unterminated quote: everything read so far
}

/**
 * The `description` value of a frontmatter, or null when the key is absent.
 * Covers the forms a SKILL.md actually uses: plain text on one line or
 * continued on indented lines, double or single quotes (possibly spanning
 * lines), and the `|` / `>` block scalars. The plugin ships without
 * node_modules, so this is a reader of those forms, not a YAML parser.
 */
function descriptionOf(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((l) => /^description:(\s|$)/.test(l));
  if (start < 0) return null;
  const head = lines[start].replace(/^description:[ \t]*/, "");
  // The value owns every following line that is blank or indented; the next
  // top-level key (column 0) ends it.
  const body = [];
  for (let i = start + 1; i < lines.length && /^(\s|$)/.test(lines[i]); i += 1) body.push(lines[i]);
  while (body.length && body.at(-1).trim() === "") body.pop();

  if (/^[|>][-+0-9]*[ \t]*(#.*)?$/.test(head)) {
    const indents = body.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length);
    const indent = indents.length ? Math.min(...indents) : 0;
    return body.map((l) => l.slice(indent)).join("\n").trim();
  }
  const folded = [head, ...body.map((l) => l.trim())].join(" ").trim();
  if (folded.startsWith('"') || folded.startsWith("'")) return quoted(folded);
  return folded.replace(/\s#.*$/, "").trim();
}

/** The neighbourhood of the first chevron, on one line. */
function excerpt(description) {
  const flat = description.replace(/\s+/g, " ");
  const at = flat.search(/[<>]/);
  const from = Math.max(0, at - 30);
  const to = Math.min(flat.length, at + 30);
  return `${from > 0 ? "..." : ""}${flat.slice(from, to)}${to < flat.length ? "..." : ""}`;
}

/** Every skills/<name>/SKILL.md under `root` (a plugin root, or a skills/
 *  folder itself), with the ones whose description holds a chevron. */
function scan(root) {
  const skills = basename(root) === "skills" ? root : join(root, "skills");
  const result = { skills, total: 0, fautifs: [], sansDescription: [] };
  if (!existsSync(skills)) return result;
  for (const nom of readdirSync(skills).sort()) {
    const file = join(skills, nom, "SKILL.md");
    if (!statSync(join(skills, nom)).isDirectory() || !existsSync(file)) continue;
    result.total += 1;
    const fm = frontmatterOf(readFileSync(file, "utf8"));
    const description = fm === null ? null : descriptionOf(fm);
    if (description === null) {
      result.sansDescription.push(nom);
    } else if (/[<>]/.test(description)) {
      result.fautifs.push({ nom, extrait: excerpt(description) });
    }
  }
  return result;
}

// ── The reader, on each YAML form ────────────────────────────────────
check(
  "guillemets doubles : les guillemets echappes restent dans la valeur",
  descriptionOf('name: x\ndescription: "Adds Google login (\\"Continue with Google\\") to a project."') ===
    'Adds Google login ("Continue with Google") to a project.',
);
check(
  "guillemets doubles sur deux lignes : la valeur est repliee",
  descriptionOf('description: "Starts here\n  and ends here."\ncompatibility: ">= 2.1"') === "Starts here and ends here.",
);
check(
  "guillemets simples : la paire '' vaut une apostrophe",
  descriptionOf("description: 'It''s quoted the other way.'") === "It's quoted the other way.",
);
check(
  "texte nu sur plusieurs lignes : les lignes indentees en font partie, pas la cle suivante",
  descriptionOf("description: Starts on the key line\n  and continues below.\nallowed-tools: Bash") ===
    "Starts on the key line and continues below.",
);
check(
  "texte nu commence a la ligne suivante",
  descriptionOf("description:\n  The whole value sits on the next line.") === "The whole value sits on the next line.",
);
check(
  "bloc litteral | : l'indicateur n'est pas dans la valeur",
  descriptionOf("description: |\n  Line one.\n  Line two.\nname: x") === "Line one.\nLine two.",
);
check(
  "bloc plie >- : l'indicateur n'est pas dans la valeur",
  descriptionOf("description: >-\n  Folded text\n  on two lines.\nargument-hint: <projet>") === "Folded text\non two lines.",
);
check("fins de ligne CRLF", descriptionOf("name: x\r\ndescription: Clean text.\r\nargument-hint: <p>") === "Clean text.");
check("cle absente : null", descriptionOf("name: x\nargument-hint: <projet>") === null);
check("fichier sans frontmatter : null", frontmatterOf("# Just a title\n\nSome text.") === null);
check("marque d'ordre d'octets ignoree", frontmatterOf(`${BOM}---\nname: x\n---\n`) === "name: x");

// ── Both directions, on a fixture skills/ folder ─────────────────────
// A check is only trusted once it has been seen doing both things: reporting
// what the validator refuses, and staying quiet on what it accepts. The same
// forms as the real skills, plus the ones nobody uses yet.
const box = mkdtempSync(join(tmpdir(), "hv-skill-desc-"));
function fixture(nom, frontmatter, { crlf = false } = {}) {
  mkdirSync(join(box, "skills", nom), { recursive: true });
  const text = `---\n${frontmatter}\n---\n\n# ${nom}\n`;
  writeFileSync(join(box, "skills", nom, "SKILL.md"), crlf ? text.replace(/\n/g, "\r\n") : text);
}
const PROPRES = {
  "texte-nu": "name: a\ndescription: Guide the user, then Cloudflare, then Vercel.",
  "texte-nu-suite-indentee": "name: b\ndescription: Starts on the key line\n  and continues below.\nallowed-tools: Bash",
  "texte-nu-ligne-suivante": "name: c\ndescription:\n  The whole value sits on the next line.",
  "guillemets-doubles": 'name: d\ndescription: "Adds Google login (\\"Continue with Google\\") to a project."',
  "guillemets-doubles-suite": 'name: e\ndescription: "Starts here\n  and ends here."\ncompatibility: ">= 2.1"',
  "guillemets-simples": "name: f\ndescription: 'It''s quoted the other way.'",
  "bloc-litteral": "name: g\ndescription: |\n  Line one.\n  Line two.",
  "bloc-plie": "name: h\ndescription: >-\n  Folded text\n  on two lines.\nargument-hint: <projet>",
  "chevrons-dans-les-autres-champs":
    'name: i\ndescription: Clean text.\nargument-hint: <domaine> --project=<projet>\ncompatibility: "Claude Code >= 2.1"',
  "fins-de-ligne-crlf": "name: j\ndescription: Clean text on CRLF lines.\nargument-hint: <projet>",
};
const FAUTIVES = {
  "chevron-texte-nu": "name: k\ndescription: Target architecture: <Registrar> -> Cloudflare -> Vercel.",
  "chevron-guillemets-doubles": 'name: l\ndescription: "Pass <name> as the argument."',
  "chevron-guillemets-simples": "name: m\ndescription: 'Use <projet> here.'",
  "chevron-suite-indentee": "name: n\ndescription: Starts clean\n  then a <tag> on the continuation line.",
  "chevron-bloc-plie": "name: o\ndescription: >\n  Folded with a <tag> inside.",
  "fleche-seule": "name: p\ndescription: Registrar -> Cloudflare, an arrow is a chevron too.",
};
for (const [nom, fm] of Object.entries(PROPRES)) fixture(nom, fm, { crlf: nom === "fins-de-ligne-crlf" });
for (const [nom, fm] of Object.entries(FAUTIVES)) fixture(nom, fm);
mkdirSync(join(box, "skills", "sans-description"));
writeFileSync(join(box, "skills", "sans-description", "SKILL.md"), "---\nname: q\nargument-hint: <projet>\n---\n");
mkdirSync(join(box, "skills", "sans-frontmatter"));
writeFileSync(join(box, "skills", "sans-frontmatter", "SKILL.md"), "# Just a title\n");

const essai = scan(box);
const attendues = Object.keys(PROPRES).length + Object.keys(FAUTIVES).length + 2;
check("toutes les fixtures sont lues", essai.total === attendues, `${essai.total}/${attendues}`);
for (const nom of Object.keys(PROPRES)) {
  check(`acceptee : ${nom}`, !essai.fautifs.some((f) => f.nom === nom) && !essai.sansDescription.includes(nom));
}
for (const nom of Object.keys(FAUTIVES)) {
  const f = essai.fautifs.find((x) => x.nom === nom);
  check(`refusee : ${nom}`, Boolean(f), f?.extrait);
}
check(
  "une description absente est signalee a part, jamais comme un chevron",
  essai.sansDescription.includes("sans-description") &&
    essai.sansDescription.includes("sans-frontmatter") &&
    !essai.fautifs.some((f) => f.nom.startsWith("sans-")),
);
check(
  "rien d'autre n'est signale",
  essai.fautifs.length === Object.keys(FAUTIVES).length && essai.sansDescription.length === 2,
  `${essai.fautifs.length} refusees, ${essai.sansDescription.length} sans description`,
);
rmSync(box, { recursive: true, force: true });

// ── The real skills ──────────────────────────────────────────────────
const cible = process.argv[2] ? resolve(process.argv[2]) : ROOT;
const reel = scan(cible);
if (process.argv[2]) console.log(`\nSkills lues dans ${reel.skills}`);
check("le dossier skills/ existe et contient des skills", reel.total > 0);
for (const nom of reel.sansDescription) {
  check(`skills/${nom} : description presente`, false, "champ absent ou frontmatter illisible");
}
for (const f of reel.fautifs) {
  check(`skills/${f.nom} : description sans chevron`, false, f.extrait);
}
if (reel.total > 0 && !reel.sansDescription.length && !reel.fautifs.length) {
  check(`${reel.total} descriptions sans chevron : le televersement Claude Desktop les acceptera`, true);
}

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
