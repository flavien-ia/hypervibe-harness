#!/usr/bin/env node
// test-a11y-audit.mjs - Recette of scripts/a11y-audit.mjs, the engine of /accessibility.
//
// Each rule in both directions: it fires on the code that shuts someone out, and stays silent on
// its accessible counterpart (an empty alternative for a decorative image, a name read by a screen
// reader only, a label that wraps its field...). An audit that cries wolf is ignored, one that
// stays silent is believed: both are failures. The measure online reads PageSpeed's answer, keeps
// the failing checks with their elements, and never lets the key out.
//
// No network: the project is written in a temporary folder, and `fetch` is a fake PageSpeed.
//
//   node scripts/tests/test-a11y-audit.mjs

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { scanProject, readPsi, measure } = await import(pathToFileURL(join(ROOT, "scripts", "a11y-audit.mjs")).href);
const KEY = "AIza-cle-de-recette-qui-ne-doit-jamais-sortir";

let checks = 0;
let failures = 0;
function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok || !detail ? "" : `   (${String(detail).slice(0, 500)})`}`);
}

const box = mkdtempSync(join(tmpdir(), "hv-a11y-"));
function project(name, files) {
  const dir = join(box, name);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const bad = project("exclut", {
  "src/app/layout.tsx": `export default function Layout({ children }) {
  return (
    <html>
      <body>
        <nav><a href="/">Accueil</a></nav>
        <div>{children}</div>
      </body>
    </html>
  );
}
export const viewport = { width: "device-width", maximumScale: 1 };
`,
  "src/components/page.tsx": `import Image from "next/image";
import { X, Menu } from "lucide-react";
export function Page({ f, logo }) {
  return (
    <section className="animate-bounce">
      <img src="/a.png" />
      <Image src={logo} width={10} height={10} />
      <button onClick={f}><X /></button>
      <a href="/compte"><Menu /></a>
      <Link href="/tarifs">cliquez ici</Link>
      <input type="email" placeholder="Votre email" />
      <div onClick={f}>Ouvrir</div>
      <span tabIndex={2}>avant tout le monde</span>
      <button aria-hidden="true">Caché mais atteignable</button>
      <iframe src="https://www.example.org/carte" />
      <video src="/film.mp4" autoPlay />
      <button className="rounded outline-none">Valider</button>
      <input className="w-full overflow-hidden" />
      <div className="fixed inset-0 bg-black/40" onClick={f}>
        <div className="rounded-xl bg-white p-6" onClick={(e) => e.stopPropagation()}>Fenêtre</div>
      </div>
      <h2>Titre</h2>
      <h4>Sous-titre qui saute un niveau</h4>
    </section>
  );
}
`,
  // A PDF drawn by the server: its <Image> has no alternative to give, the file is no page.
  "src/server/attestation.tsx": `import { Document, Page, Image } from "@react-pdf/renderer";
export const Attestation = ({ logo }) => <Document><Page><Image src={logo} /></Page></Document>;
`,
});

const good = project("accueille", {
  "src/app/layout.tsx": `export const metadata = { title: "Vitrine" };
export default function Layout({ children }) {
  return (
    <html lang="fr">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only">Aller au contenu</a>
        <nav><a href="/">Accueil</a></nav>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
export const viewport = { width: "device-width", maximumScale: 5 };
`,
  "src/components/page.tsx": `import Image from "next/image";
import { X, Menu } from "lucide-react";
export function Page({ f, g, logo, label }) {
  return (
    <section className="animate-spin motion-reduce:animate-none">
      <img src="/deco.png" alt="" />
      <Image src={logo} alt="Logo de la vitrine" width={10} height={10} />
      <button onClick={f} aria-label="Fermer"><X aria-hidden /></button>
      <button onClick={f}><X aria-hidden /><span className="sr-only">Fermer</span></button>
      <button onClick={f}>{label}</button>
      <a href="/compte" aria-label="Mon compte"><Menu aria-hidden /></a>
      <Link href="/tarifs">Voir les tarifs</Link>
      <label htmlFor="email">Votre email</label>
      <input id="email" type="email" />
      <label>Votre nom <input type="text" /></label>
      <input type="hidden" name="jeton" />
      <input type="submit" value="Envoyer" />
      <div role="button" tabIndex={0} onClick={f} onKeyDown={g}>Ouvrir</div>
      <span tabIndex={0}>dans l'ordre</span>
      <span tabIndex={-1}>atteignable par le code</span>
      <iframe title="Carte de l'atelier" src="https://www.example.org/carte" />
      <video src="/fond.mp4" autoPlay muted loop />
      <button className="rounded outline-none focus-visible:ring-2">Valider</button>
      {/* <img src="/dans-un-commentaire.png" /> */}
      <input type="file" className="hidden" />
      <label htmlFor="ville">Ville</label>
      <input id="ville" className="champ-maison outline-none" />
      <h2>Titre</h2>
      <h3>Sous-titre</h3>
    </section>
  );
}
// <html> dans un commentaire n'est pas une page
`,
  // The focus of .champ-maison is drawn here: outline-none in the markup does not hide it.
  "src/app/globals.css": `.champ-maison:focus-visible { outline: 2px solid #ff6040; }
`,
});

try {
  console.log("── 1. Le code qui exclut quelqu'un est signalé ──");
  const b = scanProject(bad);
  const rules = (r) => b.findings.filter((f) => f.rule === r);
  const expected = {
    "html-lang": 1,
    "zoom-blocked": 1,
    "img-alt": 2,
    "button-name": 1,
    "link-name": 1,
    "link-text-vague": 1,
    "form-label": 2,
    "overlay-escape": 1,
    "click-without-keyboard": 1,
    "tabindex-positive": 1,
    "aria-hidden-focusable": 1,
    "iframe-title": 1,
    "autoplay-sound": 1,
    "focus-invisible": 1,
    "heading-skip": 1,
  };
  for (const [rule, n] of Object.entries(expected)) {
    check(`${rule} : ${n} signalement(s)`, rules(rule).length === n, JSON.stringify(rules(rule)));
  }
  check("rien d'autre que ce qui est attendu", b.findings.length === Object.values(expected).reduce((a, n) => a + n, 0), JSON.stringify(b.findings.map((f) => f.rule)));
  const img = rules("img-alt")[0];
  check("chaque signalement dit le fichier, la ligne, le critère et son niveau", img.file === "src/components/page.tsx" && img.line === 6 && img.wcag === "1.1.1" && img.level === "A" && img.severity === "critical", JSON.stringify(img));
  const projet = b.project.map((p) => p.rule).sort().join(",");
  check("à l'échelle du projet : le titre, le lien d'évitement, la zone principale, le mouvement réduit", projet === "main-landmark,page-title,reduced-motion,skip-link", projet);
  check("le décompte par gravité couvre tout", b.summary.critical === 5 && b.summary.critical + b.summary.serious + b.summary.moderate + b.summary.minor === b.findings.length + b.project.length, JSON.stringify(b.summary));
  check("le fond d'une fenêtre est nommé à part (Échap à vérifier), pas comme un élément que le clavier n'atteint pas ; ce qui ne fait qu'arrêter le clic ne compte pas", rules("overlay-escape")[0]?.severity === "minor" && rules("click-without-keyboard").length === 1);
  check("un PDF dessiné par le serveur n'est pas une page : écarté, et compté comme tel", b.notPages === 1 && !b.findings.some((f) => f.file.includes("attestation")));

  console.log("\n── 2. Son pendant accessible ne l'est pas ──");
  const g = scanProject(good);
  check("aucun signalement dans le code accessible (un commentaire, un champ retiré de la page, un focus dessiné en CSS compris)", g.findings.length === 0, JSON.stringify(g.findings));
  check("aucun manque à l'échelle du projet", g.project.length === 0, JSON.stringify(g.project));
  check("les fichiers lus sont comptés", g.files === 2 && b.files === 2);

  console.log("\n── 3. La mesure en ligne : ce que PageSpeed dit, élément par élément ──");
  const answer = {
    lighthouseResult: {
      categories: {
        accessibility: {
          score: 0.82,
          auditRefs: [
            { id: "color-contrast", weight: 7 },
            { id: "image-alt", weight: 10 },
            { id: "label", weight: 7 },
            { id: "focus-traps", weight: 0 },
            { id: "html-has-lang", weight: 7 },
          ],
        },
      },
      audits: {
        "color-contrast": { score: 0, scoreDisplayMode: "binary", title: "Contraste insuffisant", details: { items: [{ node: { selector: ".hero p", snippet: '<p class="text-gray-400">', explanation: "Contraste de 2,5:1" } }] } },
        "image-alt": { score: 0, scoreDisplayMode: "binary", title: "Images sans alternative", details: { items: [{ node: { selector: "img.a" } }, { node: { selector: "img.b" } }, { node: { selector: "img.c" } }] } },
        label: { score: 1, scoreDisplayMode: "binary", title: "Champs étiquetés" },
        "focus-traps": { score: null, scoreDisplayMode: "manual", title: "Pas de piège au clavier" },
        "html-has-lang": { score: null, scoreDisplayMode: "notApplicable", title: "Langue" },
      },
    },
  };
  const read = readPsi(answer);
  check("le score sur 100", read.ok && read.score === 82);
  check("les vérifications qui échouent, de la plus lourde à la plus légère", read.failing.map((f) => f.id).join(",") === "image-alt,color-contrast", JSON.stringify(read.failing));
  check("avec leurs éléments (le contraste, qu'aucune lecture du code ne juge)", read.failing[1].nodes[0].selector === ".hero p" && read.failing[0].elements === 3);
  check("ce qui réussit ou ne s'applique pas n'est pas compté", !read.failing.some((f) => f.id === "label" || f.id === "html-has-lang"));
  check("ce que Lighthouse laisse à un humain est nommé", read.manual.length === 1 && read.manual[0].id === "focus-traps");

  const asked = [];
  let next = [];
  const fakeFetch = async (url) => {
    asked.push(url);
    const status = next.shift() ?? 200;
    return { ok: status >= 200 && status < 300, status, json: async () => answer };
  };
  next = [200, 429];
  let m = await measure("https://vitrine.fr,https://vitrine.fr/contact", { key: KEY, fetchImpl: fakeFetch });
  const out = JSON.stringify(m);
  check("deux pages : la première mesurée, la seconde dit son quota", m.status === "ok" && m.results[0].score === 82 && m.results[1].ok === false && /429/.test(m.results[1].error), out);
  check("l'accessibilité seule, sur mobile", asked.every((u) => /category=accessibility/.test(u) && /strategy=mobile/.test(u) && !/category=performance/.test(u)));
  check("la clé ne sort jamais", !out.includes(KEY));
  asked.length = 0;
  next = [503, 200];
  m = await measure("https://vitrine.fr", { key: KEY, fetchImpl: fakeFetch });
  check("une panne passagère de PageSpeed : relancée une fois", m.results[0].ok === true && asked.length === 2);
  const thrown = async (fn) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e;
    }
  };
  let e = await thrown(() => measure("https://vitrine.fr", { key: "", fetchImpl: fakeFetch }));
  check("sans clé : le code 3, la même clé que /seo-perf", e?.code === 3 && /seo-perf/.test(e.message));
  e = await thrown(() => measure("vitrine.fr", { key: KEY, fetchImpl: fakeFetch }));
  check("une adresse sans protocole : refus (1)", e?.code === 1);
  const network = async () => {
    throw new Error(`fetch failed for https://www.googleapis.com/?key=${KEY}`);
  };
  m = await measure("https://vitrine.fr", { key: KEY, fetchImpl: network, retries: 0 });
  check("une erreur réseau ne recopie jamais la requête (elle porte la clé)", m.status === "failed" && !JSON.stringify(m).includes(KEY), JSON.stringify(m));
} finally {
  try {
    rmSync(box, { recursive: true, force: true });
  } catch {
    /* left where it is */
  }
}

console.log(`\n${checks - failures}/${checks} verifications`);
process.exitCode = failures ? 1 : 0;
