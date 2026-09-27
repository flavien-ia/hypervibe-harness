#!/usr/bin/env node
// test-rgpd-audit.mjs - The privacy audit sees every third party a project is connected to.
//
// Until September 2026 the audit knew fourteen services, written one by one: a participant's
// project carried Sentry, Upstash and Vercel Speed Insights without the audit seeing any of
// them, and OpenRouter, added to the policy by the plugin itself, was proposed for removal
// because nothing detected it. This recette plays the REAL scripts/rgpd-audit.mjs on
// throwaway projects and holds:
// - the known services, the new ones included, and a project's own documented entries;
// - what betrays a service nobody named (a key-like variable, a package of a known service,
//   a host the code reaches), and what must NOT be taken for one (a plain link, a JSON-LD
//   `sameAs`, a comment, the project's own domain, the web's standards, placeholder images);
// - the signals set aside with a reason (scripts/privacy/review.mjs), which stop coming back.
// Nothing leaves the machine, nothing reads a real project.
//
//   node scripts/tests/test-rgpd-audit.mjs

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUDIT = join(ROOT, "scripts", "rgpd-audit.mjs");
const REVIEW = join(ROOT, "scripts", "privacy", "review.mjs");
const { hostsInCode, withoutComments } = await import(pathToFileURL(join(ROOT, "scripts", "privacy", "services.mjs")).href);

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

/** A throwaway project: files given as { relativePath: content }. */
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "hv-rgpd-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}
function audit(dir) {
  const r = spawnSync(process.execPath, [AUDIT], { cwd: dir, encoding: "utf8" });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: r.stderr || r.stdout };
  }
}
const values = (list, kind) => (list ?? []).filter((u) => u.kind === kind).map((u) => u.value);

console.log("── What a piece of code reaches, and what it only points at ──");
{
  const code = [
    '<a href="https://twitter.com/moi">Twitter</a>',
    '<Link href="https://www.youtube.com/@moi">YouTube</Link>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />',
    '<iframe src="https://www.youtube.com/embed/abc" />',
    'const API = "https://api.foobar.io/v1/items";',
    'await fetch(`https://hooks.example-crm.com/in/${id}`);',
    '// see https://docs.commented.io/guide',
    '/* https://old.commented.io */',
    'const ld = { "@context": "https://schema.org", sameAs: ["https://www.linkedin.com/in/moi", "https://github.com/moi"] };',
  ].join("\n");
  const hosts = hostsInCode(code);
  check("a link is not a contact (a and Link href)", !hosts.has("twitter.com"), [...hosts].join(","));
  check("a stylesheet the browser loads is one (link href)", hosts.has("fonts.googleapis.com"));
  check("an embedded frame is one", hosts.has("www.youtube.com"));
  check("an address kept in a constant is one", hosts.has("api.foobar.io"));
  check("a call in a template string is one", hosts.has("hooks.example-crm.com"));
  check("a comment is not code", !hosts.has("docs.commented.io") && !hosts.has("old.commented.io"));
  check("a JSON-LD sameAs only points somewhere", !hosts.has("www.linkedin.com") && !hosts.has("github.com"));
  check("a URL's // is never taken for a comment", withoutComments('x("https://a.io/b")').includes("https://a.io/b"));
}

console.log("\n── A project connected to services the old audit could not see ──");
const malo = project({
  "package.json": {
    dependencies: {
      next: "15.0.0",
      "drizzle-orm": "0.44.0",
      "@neondatabase/serverless": "1.0.0",
      "@sentry/nextjs": "9.0.0",
      "@upstash/redis": "1.0.0",
      "@upstash/ratelimit": "2.0.0",
      "@vercel/speed-insights": "1.0.0",
      "posthog-js": "1.0.0",
      "@aws-sdk/client-s3": "3.0.0",
      zod: "3.0.0",
    },
    devDependencies: { typescript: "5.0.0", "@sentry/cli": "2.0.0" },
  },
  ".env": [
    "DATABASE_URL=postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db",
    'NEXT_PUBLIC_SITE_URL="https://www.monsite.fr"',
    "SENTRY_DSN=https://k@o1.ingest.de.sentry.io/1",
    "UPSTASH_REDIS_REST_URL=https://eu1.upstash.io",
    "KV_REST_API_TOKEN=secret",
    "FOOBAR_API_KEY=secret",
    "OPENROUTER_API_KEY=sk-or",
    "WEATHER_API_KEY=secret",
    "MAX_UPLOAD_MB=10",
    "ADMIN_EMAIL=moi@monsite.fr",
  ].join("\n"),
  "sentry.client.config.ts": "import * as Sentry from \"@sentry/nextjs\";\nSentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });\n",
  "src/app/page.tsx": [
    '<a href="https://twitter.com/moi">Twitter</a>',
    '<img src="https://picsum.photos/seed/x/800/600" alt="" />',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />',
    'const own = "https://www.monsite.fr/about";',
    'const ld = { "@context": "https://schema.org" };',
    'const r = await fetch("https://api.foobar.io/v1/items");',
    'const g = await fetch("https://api.github.com/repos/moi/site");',
  ].join("\n"),
  "src/server/ai.ts": 'const API = "https://openrouter.ai/api/v1/chat/completions";\n',
  "src/lib/subprocessors.json": [
    { key: "vercel" },
    { key: "neon" },
    { key: "openrouter" },
    { key: "cloudflare", manuallyDeclared: true },
    { key: "foobar", name: "Foobar SAS", detect: { hosts: ["foobar.io"], env: ["FOOBAR_API_KEY"] } },
  ],
});
const a = audit(malo);
check("the audit runs", !a.error, a.error);
for (const k of ["sentry", "upstash", "vercel-speed-insights"]) {
  check(`${k} is detected`, a.detected?.[k] === true, JSON.stringify(a.evidence));
}
check("and reported missing from the policy", ["sentry", "upstash", "vercel-speed-insights"].every((k) => a.missing?.includes(k)), JSON.stringify(a.missing));
check("OpenRouter, put in the policy by the plugin, is detected, not stale", a.detected?.openrouter === true && !a.stale?.includes("openrouter"), JSON.stringify(a.stale));
check("the database is still detected", a.detected?.neon === true);
check("a hand-declared entry is never stale", !a.stale?.includes("cloudflare"));
check("a project's own entry is recognised by its signs", a.detected?.foobar === true && a.customKeys?.includes("foobar"));
check("nothing else is stale", (a.stale ?? []).length === 0, JSON.stringify(a.stale));

const pkgs = values(a.unidentified, "package");
const vars = values(a.unidentified, "variable");
const hosts = values(a.unidentified, "host");
check("a package of an undocumented service is named", pkgs.includes("posthog-js") && a.unidentified.find((u) => u.value === "posthog-js")?.service === "PostHog", JSON.stringify(a.unidentified));
check("an S3 client without R2 settings is AWS, to identify", pkgs.includes("@aws-sdk/client-s3"));
check("a build tool in devDependencies is not a processor", !pkgs.includes("@sentry/cli") && !pkgs.includes("typescript"));
check("a key-like variable nobody explains is reported", vars.includes("WEATHER_API_KEY"), JSON.stringify(vars));
check("variables of known services are not", !vars.some((v) => /^(SENTRY|UPSTASH|KV_REST|OPENROUTER|FOOBAR)/.test(v)), JSON.stringify(vars));
check("the project's own settings are not", !vars.includes("ADMIN_EMAIL") && !vars.includes("DATABASE_URL") && !vars.includes("NEXT_PUBLIC_SITE_URL"));
check("a setting that is not a key or an address is not", !vars.includes("MAX_UPLOAD_MB"));
check("a host the code reaches is reported, with its file", hosts.includes("fonts.googleapis.com") && hosts.includes("api.github.com") && a.unidentified.find((u) => u.value === "api.github.com")?.where === "src/app/page.tsx", JSON.stringify(hosts));
check("hosts of known services and of the project's own entries are not", !hosts.includes("openrouter.ai") && !hosts.includes("api.foobar.io"));
check("a link, the project's own domain and schema.org are not", !hosts.includes("twitter.com") && !hosts.includes("www.monsite.fr") && !hosts.includes("schema.org"));
check("placeholder images are set apart, with the reason", !hosts.includes("picsum.photos") && a.notProcessors?.some((n) => n.host === "picsum.photos"));

console.log("\n── A signal set aside with its reason does not come back ──");
{
  const noReason = spawnSync(process.execPath, [REVIEW, "add", "--kind", "host", "--value", "api.github.com"], { cwd: malo, encoding: "utf8" });
  check("setting aside without a reason is refused", noReason.status === 2);
  const ok = spawnSync(process.execPath, [REVIEW, "add", "--kind", "host", "--value", "api.github.com", "--reason", "public GitHub API read at build time, no visitor data sent"], { cwd: malo, encoding: "utf8" });
  check("setting aside with a reason is recorded", ok.status === 0, ok.stderr);
  const saved = JSON.parse(readFileSync(join(malo, ".hypervibe", "privacy-review.json"), "utf8"));
  check("in the project's own file, dated", saved.reviewed?.[0]?.value === "api.github.com" && /^\d{4}-\d{2}-\d{2}$/.test(saved.reviewed?.[0]?.reviewedAt ?? ""));
  const b = audit(malo);
  check("the next audit lists it as reviewed, not to identify", !values(b.unidentified, "host").includes("api.github.com") && b.reviewed?.some((r) => r.value === "api.github.com" && r.reason.includes("GitHub")));
  const back = spawnSync(process.execPath, [REVIEW, "remove", "--kind", "host", "--value", "api.github.com"], { cwd: malo, encoding: "utf8" });
  check("removing it brings the question back", back.status === 0 && values(audit(malo).unidentified, "host").includes("api.github.com"));
}
rmSync(malo, { recursive: true, force: true });

console.log("\n── R2 and a bare project ──");
{
  const r2 = project({
    "package.json": { dependencies: { "@aws-sdk/client-s3": "3.0.0" } },
    ".env": "R2_BUCKET_NAME=b\nR2_ENDPOINT=https://x.r2.cloudflarestorage.com\nCLOUDFLARE_ACCOUNT_ID=a\n",
  });
  const r = audit(r2);
  check("an S3 client with R2 settings is R2", r.detected?.["cloudflare-r2"] === true);
  check("and is then not to identify", !values(r.unidentified, "package").includes("@aws-sdk/client-s3"), JSON.stringify(r.unidentified));
  check("nor are its variables, the account id included", !values(r.unidentified, "variable").some((v) => /^R2_|CLOUDFLARE_ACCOUNT_ID/.test(v)), JSON.stringify(r.unidentified));
  rmSync(r2, { recursive: true, force: true });
  const idOnly = project({ "package.json": { dependencies: { next: "15.0.0" } }, ".env": "CLOUDFLARE_ACCOUNT_ID=a\n" });
  const i = audit(idOnly);
  check("an account id alone detects no storage, and stays to identify", !i.detected?.["cloudflare-r2"] && values(i.unidentified, "variable").includes("CLOUDFLARE_ACCOUNT_ID"), JSON.stringify(i));
  rmSync(idOnly, { recursive: true, force: true });
  const bare = project({ "package.json": { dependencies: { next: "15.0.0" } } });
  const b = audit(bare);
  check("a bare project has its host, and nothing to identify", b.detectedKeys?.length === 1 && b.detected?.vercel === true && b.unidentified?.length === 0, JSON.stringify(b.detectedKeys));
  rmSync(bare, { recursive: true, force: true });
}

console.log("\n── The catalogue covers every service the audit names, and takes a whole entry ──");
{
  const UPP = join(ROOT, "scripts", "update-privacy-policy.mjs");
  const catalog = JSON.parse(spawnSync(process.execPath, [UPP, "--catalog"], { encoding: "utf8" }).stdout);
  const { SERVICES } = await import(pathToFileURL(join(ROOT, "scripts", "privacy", "services.mjs")).href);
  const orphans = SERVICES.map((s) => s.key).filter((k) => !catalog[k]);
  check("every service the audit can detect has its catalogue entry (so --add works)", orphans.length === 0, orphans.join(", "));
  const REQUIRED = ["name", "address", "country", "purpose", "retention", "legalBasis", "privacyUrl"];
  for (const k of ["sentry", "upstash", "vercel-speed-insights"]) {
    const e = catalog[k];
    const holes = e ? REQUIRED.filter((f) => typeof e[f] !== "string" || !e[f].trim()) : ["(absent)"];
    check(`${k}: complete, in French and English`, holes.length === 0 && Array.isArray(e?.dataTypes) && e.dataTypes.length > 0 && typeof e?.isEUResident === "boolean" && e?.i18n?.en?.purpose, holes.join(", "));
  }
  const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
  const dashes = Object.entries(catalog).filter(([, e]) => LONG_DASH.test(JSON.stringify(e))).map(([k]) => k);
  check("no long dash anywhere in the published texts", dashes.length === 0, dashes.join(", "));

  const dir = project({ "package.json": { dependencies: { next: "15.0.0" } } });
  const good = join(dir, "entry.json");
  writeFileSync(good, JSON.stringify({
    key: "foobar", name: "Foobar SAS", address: "1 rue de la Paix, 75002 Paris, France", country: "FR",
    purpose: "Envoi des messages du formulaire", dataTypes: ["Nom", "Email"], retention: "12 mois",
    legalBasis: "Intérêt légitime (art. 6.1.f RGPD)", isEUResident: true, transferMechanism: null,
    privacyUrl: "https://foobar.example/privacy", custom: true, detect: { hosts: ["foobar.example"] },
    sources: ["https://foobar.example/privacy"], checkedAt: "2026-09-23",
  }));
  const added = spawnSync(process.execPath, [UPP, "--entry", good], { cwd: dir, encoding: "utf8" });
  const reg = JSON.parse(readFileSync(join(dir, "src", "lib", "subprocessors.json"), "utf8"));
  check("a whole entry is written, its own signs with it", added.status === 0 && reg[0]?.key === "foobar" && reg[0]?.detect?.hosts?.[0] === "foobar.example", added.stderr);
  const ts = readFileSync(join(dir, "src", "lib", "subprocessors.ts"), "utf8");
  check("the registry's type knows a project's own entries", /custom\?: boolean/.test(ts) && /detect\?:/.test(ts) && /sources\?: string\[\]/.test(ts));
  const half = join(dir, "half.json");
  writeFileSync(half, JSON.stringify({ key: "moitie", name: "Moitié SAS", privacyUrl: "https://moitie.example" }));
  const refused = spawnSync(process.execPath, [UPP, "--entry", half], { cwd: dir, encoding: "utf8" });
  const after = JSON.parse(readFileSync(join(dir, "src", "lib", "subprocessors.json"), "utf8"));
  check("a half-filled entry is refused, and nothing is written", refused.status === 2 && /Incomplete entry/.test(refused.stderr) && after.length === 1);
  const unknown = spawnSync(process.execPath, [UPP, "--add", "posthog"], { cwd: dir, encoding: "utf8" });
  check("--add still refuses a key outside the catalogue, and says how to document it", unknown.status === 2 && /--entry/.test(unknown.stderr));
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n── What an outside review of 3.3.0 measured ──");
{
  const UPP = join(ROOT, "scripts", "update-privacy-policy.mjs");
  const base = {
    key: "openai", name: "OpenAI, L.L.C.", address: "San Francisco, États-Unis", country: "US",
    purpose: "Génération de texte", dataTypes: ["Texte saisi"], retention: "30 jours",
    legalBasis: "Exécution du contrat (art. 6.1.b RGPD)", isEUResident: false,
    transferMechanism: "Clauses contractuelles types", privacyUrl: "https://openai.com/policies/privacy-policy",
    custom: true, sources: ["https://openai.com/policies/privacy-policy"], checkedAt: "2026-09-24",
  };
  const dir = project({ "package.json": { dependencies: { next: "15.0.0", openai: "5.0.0" } } });
  const tryEntry = (entry) => {
    const f = join(dir, "entry.json");
    writeFileSync(f, JSON.stringify(entry));
    return spawnSync(process.execPath, [UPP, "--entry", f], { cwd: dir, encoding: "utf8" });
  };
  const noDetect = tryEntry(base);
  check("an entry with neither detect nor manuallyDeclared is refused, and says why", noDetect.status === 2 && /detect \(or manuallyDeclared\)/.test(noDetect.stderr) && /detection rule to write/.test(noDetect.stderr), noDetect.stderr);
  const noSources = tryEntry({ ...base, detect: { deps: ["openai"] }, sources: undefined, checkedAt: undefined });
  check("an entry without sources and date is refused", noSources.status === 2 && /sources/.test(noSources.stderr) && /checkedAt/.test(noSources.stderr), noSources.stderr);
  const placeholder = tryEntry({ ...base, detect: { deps: ["openai"] }, privacyUrl: "à compléter" });
  check("a placeholder privacy address is refused", placeholder.status === 2 && /privacyUrl/.test(placeholder.stderr), placeholder.stderr);
  const good = tryEntry({ ...base, detect: { deps: ["openai"], env: ["OPENAI_API_KEY"] } });
  check("the same entry with its detection rule is written", good.status === 0, good.stderr);
  const kept = audit(dir);
  check("... and the next audit recognises it instead of calling it stale", kept.detectedKeys?.includes("openai") && !kept.stale?.includes("openai"), JSON.stringify(kept.stale));
  rmSync(dir, { recursive: true, force: true });

  // An entry written before this check, without its rule: never stale while a signal names it.
  const old = project({
    "package.json": { dependencies: { next: "15.0.0", openai: "5.0.0" } },
    ".env": "OPENAI_API_KEY=x\n",
    "src/lib/subprocessors.json": [base],
  });
  const r = audit(old);
  check("a registered service that a signal names is not stale", !r.stale?.includes("openai"), JSON.stringify(r.stale));
  check("... it is reported as needing its detection rule, with its signals", r.unrecognised?.[0]?.key === "openai" && r.unrecognised[0].signals.length === 2, JSON.stringify(r.unrecognised));
  check("... and those signals are not also 'to identify'", !values(r.unidentified, "package").includes("openai") && !values(r.unidentified, "variable").includes("OPENAI_API_KEY"), JSON.stringify(r.unidentified));
  rmSync(old, { recursive: true, force: true });
}
{
  const neon = { key: "neon", name: "Neon" };
  const ok = project({
    "package.json": { dependencies: { next: "15.0.0", "drizzle-orm": "0.40.0", "@neondatabase/serverless": "1.0.0" } },
    "src/lib/subprocessors.json": [neon],
  });
  const control = audit(ok);
  check("control: a valid package.json, the database is detected", control.detectedKeys?.includes("neon") && control.stale?.length === 0);
  writeFileSync(join(ok, "package.json"), '{ "dependencies": { "next": "15.0.0", "drizzle-orm": "0.40.0", "@neondatabase/serverless": "1.0.0", } }');
  const broken = audit(ok);
  check("a package.json that cannot be read proposes no removal", broken.stale?.length === 0 && broken.staleWithheld?.includes("neon"), JSON.stringify(broken.stale));
  check("... and the report names the file", broken.unreadable?.some((u) => u.file === "package.json"), JSON.stringify(broken.unreadable));
  rmSync(ok, { recursive: true, force: true });
}
{
  const call = 'export async function send() { await fetch("https://api.tracking-tiers.example/v1/hit"); }';
  const inSrc = audit(project({ "package.json": { dependencies: { next: "15.0.0" } }, "src/app/lib.ts": call }));
  const atRoot = audit(project({ "package.json": { dependencies: { next: "15.0.0" } }, "app/lib.ts": call }));
  check("control: the call is seen in src/app", values(inSrc.unidentified, "host").includes("api.tracking-tiers.example"));
  check("the same call in app/ at the root (no src folder) is seen", values(atRoot.unidentified, "host").includes("api.tracking-tiers.example"), JSON.stringify(atRoot.unidentified));
  const inScripts = audit(project({ "package.json": { dependencies: { next: "15.0.0" } }, "scripts/backfill.mjs": call }));
  check("the maintenance scripts at the root are not the site's code", !values(inScripts.unidentified, "host").includes("api.tracking-tiers.example"));
}
{
  const code = [
    '<script src="//cdn.tiers-un.example/a.js" />',
    '<link rel="stylesheet" href="//fonts.tiers-deux.example/css" />',
    '<img src="//pixel.tiers-trois.example/p.gif" />',
    "const u = url(//img.tiers-quatre.example/x.png);",
    "// cdn.commentaire.example is only mentioned",
    "//pas.un.hote.example au debut d'un commentaire",
  ].join("\n");
  const hosts = hostsInCode(code);
  check("protocol-relative addresses are seen (script, link, img, url())", ["cdn.tiers-un.example", "fonts.tiers-deux.example", "pixel.tiers-trois.example", "img.tiers-quatre.example"].every((h) => hosts.has(h)), [...hosts].join(","));
  check("... and a comment still is not one", !hosts.has("cdn.commentaire.example") && !hosts.has("pas.un.hote.example"), [...hosts].join(","));
}

console.log("\n── What an outside review of 3.3.1 measured ──");
{
  const UPP = join(ROOT, "scripts", "update-privacy-policy.mjs");
  const pkg = { dependencies: { next: "15.0.0" } };
  const rootApp = project({ "package.json": pkg, "app/layout.tsx": "export default function L() { return null; }", "app/politique-de-confidentialite/page.tsx": "export default function P() { return null; }" });
  const a = audit(rootApp);
  check("app/ at the root: the policy found there is the served one", /(^|\/)app\/politique-de-confidentialite\/page\.tsx$/.test(a.policyPagePath ?? "") && !/\/src\//.test(a.policyPagePath ?? ""), a.policyPagePath);
  check("... the application folder reported is app/ at the root", /\/app$/.test(a.appDir ?? "") && !/\/src\//.test(a.appDir ?? ""), a.appDir);
  check("... and the registry belongs in lib/ next to it", /\/lib\/subprocessors\.json$/.test(a.registryPath ?? "") && !/\/src\//.test(a.registryPath ?? ""), a.registryPath);
  const added = spawnSync(process.execPath, [UPP, "--add", "vercel"], { cwd: rootApp, encoding: "utf8" });
  check("... where the registry script writes it", added.status === 0 && existsSync(join(rootApp, "lib", "subprocessors.json")) && !existsSync(join(rootApp, "src")), added.stderr);
  rmSync(rootApp, { recursive: true, force: true });

  const ignored = project({ "package.json": pkg, "app/layout.tsx": "export default function L() { return null; }", "src/app/politique-de-confidentialite/page.tsx": "export default function P() { return null; }" });
  const b = audit(ignored);
  check("a policy in src/app of a project with app/ at its root is never served, and said so", b.policyPagePath === null && /src\/app\/politique-de-confidentialite/.test(b.policyPageIgnoredPath ?? ""), JSON.stringify({ served: b.policyPagePath, ignored: b.policyPageIgnoredPath }));
  rmSync(ignored, { recursive: true, force: true });

  const srcProject = project({ "package.json": pkg, "src/app/politique-de-confidentialite/page.tsx": "export default function P() { return null; }" });
  const c = audit(srcProject);
  check("control: a project with src/ keeps src/app and src/lib", /src\/app\/politique-de-confidentialite/.test(c.policyPagePath ?? "") && /src\/lib\/subprocessors\.json$/.test(c.registryPath ?? "") && c.policyPageIgnoredPath === null, JSON.stringify(c.registryPath));
  rmSync(srcProject, { recursive: true, force: true });

  const call = (host) => `export default async function P() { await fetch("https://${host}/x"); return null; }`;
  const routes = project({
    "package.json": pkg,
    "src/app/contact/page.tsx": call("api.tiers-contact.example"),
    "src/app/(outils)/build/page.tsx": call("api.tiers-build.example"),
    "src/app/out/page.tsx": call("api.tiers-out.example"),
    "src/app/test/page.tsx": call("api.tiers-test.example"),
    "build/chunk.js": call("api.tiers-sortie.example"),
  });
  const r = values(audit(routes).unidentified, "host");
  check("control: a route's call is seen", r.includes("api.tiers-contact.example"), r.join(","));
  check("routes named build, out or test are read like any other", ["api.tiers-build.example", "api.tiers-out.example", "api.tiers-test.example"].every((h) => r.includes(h)), r.join(","));
  check("... while the build output at the root is not", !r.includes("api.tiers-sortie.example"), r.join(","));
  rmSync(routes, { recursive: true, force: true });

  const css = project({
    "package.json": pkg,
    "src/app/page.tsx": call("api.tiers-controle.example"),
    "src/app/globals.css": '@import url("https://fonts.tiers-polices.example/css2?family=Inter");\n.hero { background: url(//pixel.tiers-pixel.example/p.gif); }\n/* https://commentaire.tiers-css.example */',
  });
  const s = values(audit(css).unidentified, "host");
  check("a font imported by a stylesheet is seen", s.includes("fonts.tiers-polices.example"), s.join(","));
  check("... and an image a stylesheet loads, even protocol-relative", s.includes("pixel.tiers-pixel.example"), s.join(","));
  check("... but not an address in a CSS comment", !s.includes("commentaire.tiers-css.example"), s.join(","));
  rmSync(css, { recursive: true, force: true });
}

console.log("\n── A private tool: no legal pages, and no registry recreated (hypervibe-learn, 27/09/2026) ──");
{
  const UPP = join(ROOT, "scripts", "update-privacy-policy.mjs");
  const MARK = "# Project\n\n<!-- hypervibe:no-legal-pages -->\n**Legal pages: none, this is a private tool.**\n";
  const priv = project({ "package.json": { dependencies: { next: "15.0.0" } }, "CLAUDE.md": MARK, "src/app/page.tsx": "export default function P() { return null; }" });
  const r = spawnSync(process.execPath, [UPP, "--add", "vercel"], { cwd: priv, encoding: "utf8" });
  check("an /add-* on a private tool does not recreate the registry", r.status === 0 && !existsSync(join(priv, "src", "lib", "subprocessors.json")) && /private tool/.test(r.stdout), r.stdout + r.stderr);
  check("the audit says the project is a private tool", audit(priv).privateTool === true);
  mkdirSync(join(priv, "src", "lib"), { recursive: true });
  writeFileSync(join(priv, "src", "lib", "subprocessors.json"), "[]\n");
  const kept = spawnSync(process.execPath, [UPP, "--add", "vercel"], { cwd: priv, encoding: "utf8" });
  check("... but a registry that exists is still kept up to date", kept.status === 0 && JSON.parse(readFileSync(join(priv, "src", "lib", "subprocessors.json"), "utf8")).some((e) => e.key === "vercel"), kept.stderr);
  rmSync(priv, { recursive: true, force: true });
  const plain = project({ "package.json": { dependencies: { next: "15.0.0" } }, "CLAUDE.md": "# Project\n" });
  check("control: an unmarked project is not a private tool", audit(plain).privateTool === false);
  rmSync(plain, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) {
  console.error(`${failures} FAILURE(S)`);
  process.exit(1);
}
