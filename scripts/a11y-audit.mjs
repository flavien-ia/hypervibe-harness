#!/usr/bin/env node
// a11y-audit.mjs - The engine of /accessibility: what a project's code and its pages online do for
// the people who see, hear, move or read differently.
//
//   node a11y-audit.mjs scan [--dir <projet>]
//       Reads the project's JSX/TSX (no network) and reports what an automated reading can be sure
//       of: an image without a text alternative, a button or a link without a name, a form field
//       without a label, a clickable element the keyboard cannot reach, a positive tab order, a
//       focus made invisible, zoom blocked, media that plays sound by itself, a frame without a
//       title, headings that skip a level, and, for the whole project, the language of the page,
//       its title, a link to skip the navigation, the main landmark and reduced motion.
//   PSI_KEY=<clé> node a11y-audit.mjs measure --urls "<url>,<url>" [--strategy mobile|desktop]
//       Measures pages online with PageSpeed Insights, accessibility only (Lighthouse's audits,
//       axe-core on Google's side): the score, each failing check with the elements concerned
//       (colour contrast included, which no reading of the code can judge), and the checks Lighthouse
//       leaves to a human. The key comes from the environment, never an argument, and is never printed.
//
// Each subcommand prints ONE JSON object. Nothing here changes the project.
// An automated audit finds part of the problems only (about a third, by the usual estimates): the
// skill says so, and asks for the checks only a person can make (keyboard, zoom, screen reader).
//
// EXIT CODES   0 done   1 usage   3 no PageSpeed key   4 the measure failed for every page

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "out", ".turbo", ".vercel", ".git", "coverage", "public"]);
const SOURCE = /\.(tsx|jsx)$/;
const MAX_FILES = 3000;

// ─── Reading JSX, without a parser ───────────────────────────────────────────

/** The end of an opening tag that starts at `start` (its `<`): quotes and braces are skipped. */
function tagEnd(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth <= 0) return i;
  }
  return -1;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const clip = (s) => s.replace(/\s+/g, " ").trim().slice(0, 140);

/** Comments blanked out, their line breaks kept (a `<html>` in a comment is no page). Block
 *  comments, JSX ones included, and the lines that are only a comment: a `//` after code may sit
 *  in a string or in a page's text (an address), it is left alone. */
const blankComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/.*$/gm, (m) => m.replace(/./g, " "));

/** A file whose JSX is not a page for people: a PDF (react-pdf) or an image drawn by the server
 *  (next/og, satori). Its <Image> has no alternative to give, its layout no keyboard to serve. */
const NOT_A_PAGE = /from\s+["'](@react-pdf\/renderer|next\/og|@vercel\/og|satori)["']/;

/** Every opening tag of these names: {name, attrs, start, end, selfClosing}. */
function openingTags(text, names) {
  const out = [];
  const re = new RegExp(`<(${names.join("|")})(?=[\\s/>])`, "g");
  let m;
  while ((m = re.exec(text))) {
    const end = tagEnd(text, m.index);
    if (end < 0) continue;
    const raw = text.slice(m.index, end + 1);
    out.push({ name: m[1], attrs: raw.slice(m[1].length + 1, raw.endsWith("/>") ? -2 : -1), start: m.index, end, selfClosing: raw.endsWith("/>") });
  }
  return out;
}

const has = (attrs, name) => new RegExp(`(^|\\s)${name}(\\s*=|\\s|$)`).test(attrs);
const spreads = (attrs) => /\{\s*\.\.\./.test(attrs);
const value = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["'\`]([^"'\`]*)["'\`]\\s*\\}|\\{([^}]*)\\})`).exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
};
const named = (attrs) => has(attrs, "aria-label") || has(attrs, "aria-labelledby") || has(attrs, "title");

/** The text a person reads inside an element: tags removed. An expression may render text. */
function innerOf(text, tag) {
  if (tag.selfClosing) return { text: "", expression: false };
  const close = text.indexOf(`</${tag.name}>`, tag.end);
  if (close < 0) return { text: "", expression: true };
  const inner = text.slice(tag.end + 1, close);
  const srOnly = /sr-only|visually-hidden/.test(inner);
  const withoutTags = inner.replace(/<[^>]*>/g, " ");
  const expression = /\{[^}]*\}/.test(withoutTags.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ""));
  return { text: withoutTags.replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim(), expression: expression || srOnly };
}

// ─── The rules on one file ───────────────────────────────────────────────────

const RULES = {
  "img-alt": { severity: "critical", wcag: "1.1.1", level: "A" },
  "button-name": { severity: "critical", wcag: "4.1.2", level: "A" },
  "form-label": { severity: "critical", wcag: "1.3.1", level: "A" },
  "link-name": { severity: "serious", wcag: "2.4.4", level: "A" },
  "click-without-keyboard": { severity: "serious", wcag: "2.1.1", level: "A" },
  "tabindex-positive": { severity: "serious", wcag: "2.4.3", level: "A" },
  "aria-hidden-focusable": { severity: "serious", wcag: "4.1.2", level: "A" },
  "iframe-title": { severity: "serious", wcag: "4.1.2", level: "A" },
  "autoplay-sound": { severity: "serious", wcag: "1.4.2", level: "A" },
  "html-lang": { severity: "serious", wcag: "3.1.1", level: "A" },
  "focus-invisible": { severity: "serious", wcag: "2.4.7", level: "AA" },
  "zoom-blocked": { severity: "serious", wcag: "1.4.4", level: "AA" },
  "link-text-vague": { severity: "moderate", wcag: "2.4.4", level: "A" },
  "heading-skip": { severity: "moderate", wcag: "1.3.1", level: "A" },
  "page-title": { severity: "serious", wcag: "2.4.2", level: "A" },
  "skip-link": { severity: "moderate", wcag: "2.4.1", level: "A" },
  "main-landmark": { severity: "moderate", wcag: "1.3.1", level: "A" },
  "reduced-motion": { severity: "minor", wcag: "2.3.3", level: "AAA" },
  "overlay-escape": { severity: "minor", wcag: "2.1.1", level: "A" },
};
const VAGUE = /^(cliquez ici|cliquer ici|ici|click here|here|en savoir plus|lire la suite|voir plus|plus|read more|learn more|more|lien)$/i;
const INTERACTIVE = ["button", "a", "Link", "input", "select", "textarea"];

/** A handler that only stops the click from going further: no action to reach by keyboard. */
const ONLY_STOPS = /(^|\s)onClick\s*=\s*\{\s*\(?\s*\w*\s*\)?\s*=>\s*\{?\s*\w+\.(stopPropagation|preventDefault)\(\)\s*;?\s*\}?\s*\}/;

/**
 * The findings of one file, and what it says for the project-wide checks.
 * `focusClasses`: the classes the project's stylesheets give a :focus style (a focus drawn in CSS
 * is a visible focus, whatever `outline-none` says in the markup).
 */
export function scanFile(source, file, { focusClasses = new Set() } = {}) {
  const text = blankComments(source);
  const findings = [];
  const add = (rule, index, snippet) => findings.push({ rule, ...RULES[rule], file, line: lineOf(text, index), snippet: clip(snippet) });
  const signals = {
    htmlTag: false,
    lang: false,
    title: /export\s+const\s+metadata\b[\s\S]{0,400}?\btitle\b|export\s+(async\s+)?function\s+generateMetadata\b/.test(text),
    main: /<main(?=[\s>])/.test(text),
    skip: /href\s*=\s*["'{`]*#(main|contenu|content|principal)/i.test(text),
    nav: /<(nav|header)(?=[\s>])/.test(text),
    motion: /\banimate-(?!spin\b|pulse\b|none\b)[a-z]|from\s+["'](framer-motion|motion\/react)["']|@keyframes/.test(text),
    reducedMotion: /motion-reduce:|motion-safe:|useReducedMotion|prefers-reduced-motion/.test(text),
  };

  for (const t of openingTags(text, ["img", "Image"])) {
    if (!has(t.attrs, "alt") && !spreads(t.attrs) && !/aria-hidden/.test(t.attrs)) add("img-alt", t.start, `<${t.name}${t.attrs}>`);
  }
  for (const t of openingTags(text, ["html"])) {
    signals.htmlTag = true;
    if (has(t.attrs, "lang")) signals.lang = true;
    else add("html-lang", t.start, `<html${t.attrs}>`);
  }
  for (const t of openingTags(text, ["button"])) {
    if (named(t.attrs) || spreads(t.attrs)) continue;
    const inner = innerOf(text, t);
    if (!inner.text && !inner.expression) add("button-name", t.start, `<button${t.attrs}>`);
  }
  for (const t of openingTags(text, ["a", "Link"])) {
    if (spreads(t.attrs)) continue;
    const inner = innerOf(text, t);
    if (!named(t.attrs) && !inner.text && !inner.expression) add("link-name", t.start, `<${t.name}${t.attrs}>`);
    else if (!named(t.attrs) && VAGUE.test(inner.text)) add("link-text-vague", t.start, `<${t.name}>${inner.text}</${t.name}>`);
  }
  const labelled = new Set([...text.matchAll(/htmlFor\s*=\s*(?:"([^"]+)"|\{\s*["'`]([^"'`]+)["'`]\s*\})/g)].map((m) => m[1] ?? m[2]));
  const labelRanges = [...text.matchAll(/<label(?=[\s>])[\s\S]*?<\/label>/g)].map((m) => [m.index, m.index + m[0].length]);
  for (const t of openingTags(text, ["input", "select", "textarea"])) {
    const type = (value(t.attrs, "type") || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type) || named(t.attrs) || spreads(t.attrs)) continue;
    // Taken out of the page (display: none, a file field opened by a button): nobody reaches it.
    if (/(^|\s)hidden(\s|$)/.test(value(t.attrs, "className") || "")) continue;
    const id = value(t.attrs, "id");
    if (id && labelled.has(id)) continue;
    if (labelRanges.some(([a, b]) => t.start > a && t.start < b)) continue;
    add("form-label", t.start, `<${t.name}${t.attrs}>`);
  }
  for (const t of openingTags(text, ["div", "span", "li", "p", "section", "article", "img", "Image", "svg"])) {
    if (!/(^|\s)onClick\s*=/.test(t.attrs) || ONLY_STOPS.test(t.attrs)) continue;
    // The backdrop of a window, closed by a click: the keyboard's way is Escape, which the
    // markup does not show. Named apart, at its own weight, to be checked by hand.
    if (/(^|\s)inset-0(\s|$)/.test(value(t.attrs, "className") || "")) {
      add("overlay-escape", t.start, `<${t.name}${t.attrs}>`);
      continue;
    }
    const role = value(t.attrs, "role");
    const keys = /(^|\s)onKey(Down|Up|Press)\s*=/.test(t.attrs);
    const focusable = has(t.attrs, "tabIndex");
    if (!role || !keys || !focusable) add("click-without-keyboard", t.start, `<${t.name}${t.attrs}>`);
  }
  for (const m of text.matchAll(/tabIndex\s*=\s*(?:\{\s*(\d+)\s*\}|"(\d+)")/g)) {
    if (Number(m[1] ?? m[2]) > 0) add("tabindex-positive", m.index, m[0]);
  }
  for (const t of openingTags(text, INTERACTIVE)) {
    if (/aria-hidden\s*=\s*(?:"true"|\{\s*true\s*\})|aria-hidden(?=[\s/>]|$)/.test(t.attrs) && value(t.attrs, "tabIndex") !== "-1") {
      add("aria-hidden-focusable", t.start, `<${t.name}${t.attrs}>`);
    }
  }
  for (const t of openingTags(text, ["iframe"])) {
    if (!has(t.attrs, "title") && !spreads(t.attrs)) add("iframe-title", t.start, `<iframe${t.attrs}>`);
  }
  for (const t of openingTags(text, ["video", "audio"])) {
    if (has(t.attrs, "autoPlay") && (t.name === "audio" || !has(t.attrs, "muted"))) add("autoplay-sound", t.start, `<${t.name}${t.attrs}>`);
  }
  for (const m of text.matchAll(/className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([^`]*)`\s*\})/g)) {
    const classes = m[1] ?? m[2] ?? m[3] ?? "";
    const styledInCss = classes.split(/\s+/).some((c) => focusClasses.has(c));
    if (/(^|\s)(focus:)?outline-none(\s|$)/.test(classes) && !styledInCss && !/focus-visible:|focus:ring|focus:outline-(?!none)|focus:border|focus:shadow|focus-within:/.test(classes)) {
      add("focus-invisible", m.index, m[0]);
    }
  }
  for (const m of text.matchAll(/maximumScale\s*:\s*1(?![\d.])|maximum-scale\s*=\s*1(?![\d.])|userScalable\s*:\s*false|user-scalable\s*=\s*(?:no|0)/g)) {
    add("zoom-blocked", m.index, m[0]);
  }
  let previous = 0;
  for (const m of text.matchAll(/<h([1-6])(?=[\s>])/g)) {
    const level = Number(m[1]);
    if (previous && level > previous + 1) add("heading-skip", m.index, `<h${previous}> puis <h${level}>`);
    previous = level;
  }
  return { findings, signals };
}

// ─── The project ─────────────────────────────────────────────────────────────

function filesOf(dir, re) {
  const out = [];
  const walk = (d) => {
    if (out.length >= MAX_FILES) return;
    for (const name of readdirSync(d)) {
      if (IGNORED_DIRS.has(name) || name.startsWith(".")) continue;
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (re.test(name) && !/\.(test|spec|stories)\.(tsx|jsx)$/.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** The whole project: every file's findings, and the project-wide checks a single file cannot make. */
export function scanProject(dir) {
  if (!dir || !existsSync(dir)) throw Object.assign(new Error(`Dossier introuvable : ${dir}`), { code: 1 });
  // The project's stylesheets: a motion and its reduction may live there, and a focus drawn on a class.
  const css = filesOf(dir, /\.css$/).map((f) => readFileSync(f, "utf8")).join("\n");
  const focusClasses = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)(?::[a-z-]+(?:\([^)]*\))?)*:focus(?:-visible|-within)?\b/g)].map((m) => m[1]));
  const files = [];
  let skipped = 0;
  const findings = [];
  const seen = { htmlTag: false, lang: false, title: false, main: false, skip: false, nav: false, motion: false, reducedMotion: false };
  for (const f of filesOf(dir, SOURCE)) {
    const source = readFileSync(f, "utf8");
    if (NOT_A_PAGE.test(source)) {
      skipped += 1;
      continue;
    }
    files.push(f);
    const { findings: found, signals } = scanFile(source, relative(dir, f).split("\\").join("/"), { focusClasses });
    findings.push(...found);
    for (const k of Object.keys(seen)) seen[k] ||= signals[k];
  }
  if (/@keyframes|animation\s*:/.test(css)) seen.motion = true;
  if (/prefers-reduced-motion/.test(css)) seen.reducedMotion = true;
  const project = [];
  const note = (rule, detail) => project.push({ rule, ...RULES[rule], detail });
  if (files.length && !seen.title) note("page-title", "aucun titre de page déclaré (metadata ou generateMetadata)");
  if (seen.nav && !seen.skip) note("skip-link", "une navigation, et aucun lien pour aller directement au contenu");
  if (files.length && !seen.main) note("main-landmark", "aucune zone principale (<main>)");
  if (seen.motion && !seen.reducedMotion) note("reduced-motion", "des animations, et rien pour qui demande moins de mouvement (prefers-reduced-motion)");
  const all = [...findings, ...project];
  const count = (sev) => all.filter((f) => f.severity === sev).length;
  const byRule = {};
  for (const f of all) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  return {
    status: "ok",
    files: files.length,
    notPages: skipped,
    truncated: files.length + skipped >= MAX_FILES,
    findings,
    project,
    summary: { critical: count("critical"), serious: count("serious"), moderate: count("moderate"), minor: count("minor"), byRule },
  };
}

// ─── The measure online ──────────────────────────────────────────────────────

/** What PageSpeed Insights says of a page's accessibility. Pure: the answer in, the report out. */
export function readPsi(json) {
  const lr = json?.lighthouseResult;
  const category = lr?.categories?.accessibility;
  if (!category) return { ok: false, error: "réponse sans catégorie accessibilité" };
  const audits = lr.audits || {};
  const failing = [];
  const manual = [];
  for (const ref of category.auditRefs || []) {
    const a = audits[ref.id];
    if (!a) continue;
    if (a.scoreDisplayMode === "manual") {
      manual.push({ id: ref.id, title: a.title });
      continue;
    }
    if (a.scoreDisplayMode === "binary" && a.score === 0) {
      const nodes = (a.details?.items || []).slice(0, 5).map((it) => ({
        selector: it.node?.selector ?? null,
        snippet: it.node?.snippet ? clip(it.node.snippet) : null,
        explanation: it.node?.explanation ? clip(it.node.explanation) : null,
      }));
      failing.push({ id: ref.id, title: a.title, weight: ref.weight ?? 0, elements: a.details?.items?.length ?? 0, nodes });
    }
  }
  failing.sort((x, y) => y.weight - x.weight);
  return { ok: true, score: typeof category.score === "number" ? Math.round(category.score * 100) : null, failing, manual };
}

/** Measure pages. The key is read from the environment and never appears in what is returned. */
export async function measure(urls, { strategy = "mobile", key = process.env.PSI_KEY, fetchImpl = globalThis.fetch, retries = 1 } = {}) {
  const list = String(urls || "").split(",").map((u) => u.trim()).filter(Boolean);
  if (!list.length || list.length > 8 || !list.every((u) => /^https?:\/\/[^\s]+$/.test(u))) {
    throw Object.assign(new Error("Usage : measure --urls \"https://...,https://...\" (1 à 8 adresses)"), { code: 1 });
  }
  if (!["mobile", "desktop"].includes(strategy)) throw Object.assign(new Error("--strategy mobile ou desktop"), { code: 1 });
  if (!key) throw Object.assign(new Error("Clé PageSpeed absente (variable PSI_KEY) : la même que /seo-perf et /eco-audit."), { code: 3 });
  const results = [];
  for (const url of list) {
    const q = new URLSearchParams({ url, strategy, category: "accessibility", locale: "fr", key });
    let outcome = null;
    for (let attempt = 0; attempt <= retries && !outcome?.ok; attempt++) {
      try {
        const res = await fetchImpl(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`);
        if (res.status === 429) {
          outcome = { ok: false, error: "quota de PageSpeed atteint, ou clé refusée (HTTP 429)" };
          break;
        }
        if (!res.ok) {
          outcome = { ok: false, error: `PageSpeed a répondu HTTP ${res.status}` };
          if (res.status < 500) break;
          continue;
        }
        outcome = readPsi(await res.json());
      } catch (e) {
        // Never the request itself in the message: it carries the key.
        outcome = { ok: false, error: `PageSpeed injoignable (${String(e?.name || "erreur")})` };
      }
    }
    results.push({ url, ...outcome });
  }
  return { status: results.some((r) => r.ok) ? "ok" : "failed", strategy, results };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function flag(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}

const USAGE = `Usage: node a11y-audit.mjs scan [--dir <projet>]
       PSI_KEY=<clé> node a11y-audit.mjs measure --urls "<url>,<url>" [--strategy mobile|desktop]`;

// ─── Launched as a script, or imported ────────────────────────────────────────
// Node gives a module its real path and keeps in argv[1] the path as it was typed. Compared as
// they come, the two differ as soon as the plugin is reached through a symbolic link (macOS's
// temporary folder, a ~/.claude kept by a configuration repository): the script then did
// nothing and exited 0, "I could not" read as "nothing to report" (outside review, 3.3.9).
// Both are read to their real path. The same block in every script, held by
// scripts/tests/test-entry-point.mjs.
import { realpathSync as realPathOf } from "node:fs";
import { fileURLToPath as pathOfUrl } from "node:url";
function launchedDirectly() {
  try {
    if (!process.argv[1]) return false;
    const self = realPathOf(pathOfUrl(import.meta.url));
    const launched = realPathOf(process.argv[1]);
    return process.platform === "win32" ? self.toLowerCase() === launched.toLowerCase() : self === launched;
  } catch {
    return false;
  }
}

if (launchedDirectly()) {
  const [cmd, ...args] = process.argv.slice(2);
  const run = async () => {
    if (cmd === "scan") return scanProject(flag(args, "--dir", process.cwd()));
    if (cmd === "measure") return measure(flag(args, "--urls"), { strategy: flag(args, "--strategy", "mobile") });
    throw Object.assign(new Error(USAGE), { code: cmd === "--help" || cmd === "-h" ? 0 : 1 });
  };
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.status === "failed" ? 4 : 0;
    })
    .catch((e) => {
      if (e.code === 0) process.stdout.write(`${e.message}\n`);
      else process.stderr.write(`${e.message}\n`);
      process.exitCode = Number.isInteger(e.code) ? e.code : 1;
    });
}
