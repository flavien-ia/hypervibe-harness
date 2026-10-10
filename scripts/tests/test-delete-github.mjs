#!/usr/bin/env node
// test-delete-github.mjs - The repository /delete-project lists for manual deletion is the one the
// project's folder pushes to, and a read that failed is said, never taken for "no repository"
// (lot 7 inventory, 06/10/2026). Since 3.4.9, /delete-project deletes ONE repository itself: the
// one /bootstrap created for this project and declared in its manifest, never another, and only
// once gh has the delete_repo right. Against a fake gh: nothing reaches the forge.
//
//   node scripts/tests/test-delete-github.mjs

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { deleteRight, githubRepositoryOf, repositoryToDelete, sameRepository, settleGithubDeletion } = await import(pathToFileURL(join(ROOT, "scripts", "delete-project", "_github-repo.mjs")).href);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

/** A fake gh: `answers` maps "repo view <full>" and "api user" to what gh would say. */
function fakeGh(answers) {
  const asked = [];
  const run = async (cmd, args) => {
    asked.push(`${cmd} ${args.join(" ")}`);
    const key = args[0] === "repo" ? `repo view ${args[2]}` : args[0] === "api" ? "api user" : args.join(" ");
    return answers[key] ?? { code: 1, stdout: "", stderr: "unexpected question" };
  };
  return { run, asked };
}
const VIEW = { code: 0, stdout: JSON.stringify({ name: "flavienchervet.fr", nameWithOwner: "acme/flavienchervet.fr", url: "https://github.com/acme/flavienchervet.fr", visibility: "PRIVATE", isPrivate: true }), stderr: "" };

{
  const gh = fakeGh({ "repo view acme/flavienchervet.fr": VIEW });
  const r = await githubRepositoryOf({ projectDir: "x", project: "site", run: gh.run, origin: () => "github.com/acme/flavienchervet.fr" });
  check("the repository the folder pushes to is the one looked at, an organisation's and a dotted name included", r.exists === true && r.foundVia === "origin" && r.url === "https://github.com/acme/flavienchervet.fr", JSON.stringify(r));
  check("... and the signed-in account is never asked then", !gh.asked.some((q) => q.includes("api user")), gh.asked.join(" | "));
}
{
  const gh = fakeGh({ "repo view acme/site": { code: 1, stdout: "", stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/site'." } });
  const r = await githubRepositoryOf({ projectDir: "x", project: "site", run: gh.run, origin: () => "github.com/acme/site" });
  check("a repository the forge does not know: absent, read", r.exists === false && !r.error && r.looked === "acme/site", JSON.stringify(r));
}
{
  const gh = fakeGh({ "repo view acme/site": { code: 1, stdout: "", stderr: "error connecting to api.github.com" } });
  const r = await githubRepositoryOf({ projectDir: "x", project: "site", run: gh.run, origin: () => "github.com/acme/site" });
  check("a read that failed is an error, never an absence", r.exists === false && typeof r.error === "string" && /error connecting/.test(r.error), JSON.stringify(r));
}
{
  const gh = fakeGh({ "api user": { code: 0, stdout: "moi\n", stderr: "" }, "repo view moi/site": { ...VIEW, stdout: JSON.stringify({ name: "site", url: "https://github.com/moi/site" }) } });
  const r = await githubRepositoryOf({ projectDir: "x", project: "site", run: gh.run, origin: () => null });
  check("a folder that pushes nowhere: the account's repository of that name, said as a guess", r.exists === true && r.guessed === true && r.foundVia === undefined, JSON.stringify(r));
}
{
  const gh = fakeGh({ "api user": { code: 1, stdout: "", stderr: "not logged in" } });
  const r = await githubRepositoryOf({ projectDir: "x", project: "site", run: gh.run, origin: () => null });
  check("... and when gh cannot say who is signed in: an error, the repository was not looked for", r.exists === false && /not looked for/.test(r.error ?? ""), JSON.stringify(r));
}
{
  const gh = fakeGh({});
  const r = await githubRepositoryOf({ projectDir: "x", project: "site", run: gh.run, origin: () => "gitlab.com/acme/site" });
  check("a folder that pushes to another forge: skipped, said, nothing asked of GitHub", r.exists === false && /gitlab\.com/.test(r.skipped ?? "") && gh.asked.length === 0, JSON.stringify(r));
}

// ── Which repository /delete-project deletes itself ──
const FOUND = { exists: true, foundVia: "origin", name: "site", nameWithOwner: "Acme/Site", url: "https://github.com/Acme/Site" };
const BOOT = { kind: "github-repo", name: "acme/site", addedBy: "bootstrap", addedAt: "2026-09-23" };
{
  const d = repositoryToDelete(FOUND, [BOOT]);
  check("the repository /bootstrap created and declared, which the folder pushes to: deleted by the skill, named as GitHub names it", d.deletable === true && d.repository === "Acme/Site", JSON.stringify(d));
  check("... whatever the case the manifest wrote it in (GitHub's names ignore case)", repositoryToDelete(FOUND, [{ ...BOOT, name: "ACME/site" }]).deletable === true);
  check("a name is the repository's only when one was found", sameRepository(FOUND, "acme/SITE") && !sameRepository({ ...FOUND, exists: false }, "acme/site") && !sameRepository(FOUND, "acme/site2") && !sameRepository(FOUND, ""));
}
for (const [label, github, declared] of [
  ["found by the signed-in account and the project's name (a guess)", { ...FOUND, foundVia: undefined, guessed: true }, [BOOT]],
  ["pushed to by the folder, but the manifest does not declare it", FOUND, []],
  ["adopted from the folder's remote (manifest adopt)", FOUND, [{ ...BOOT, addedBy: "adopt" }]],
  ["declared by another skill", FOUND, [{ ...BOOT, addedBy: "add-collab" }]],
  ["declared with no author", FOUND, [{ kind: "github-repo", name: "acme/site" }]],
  ["the manifest names another repository (renamed, moved)", FOUND, [{ ...BOOT, name: "acme/ancien-site" }]],
  ["declared shared with other projects", FOUND, [{ ...BOOT, shared: true }]],
  ["no repository found", { exists: false, looked: "acme/site" }, [BOOT]],
  ["a repository gh did not name", { ...FOUND, nameWithOwner: undefined }, [BOOT]],
]) {
  const d = repositoryToDelete(github, declared);
  check(`never deleted by the skill: ${label}, and the reason is said`, d.deletable === false && typeof d.reason === "string" && d.reason.length > 10, JSON.stringify(d));
}

// ── gh's right to delete a repository ──
const statusJson = (entry) => ({ code: 0, stdout: JSON.stringify({ hosts: { "github.com": [entry] } }), stderr: "" });
const signedIn = (scopes, extra = {}) => statusJson({ state: "success", active: true, host: "github.com", login: "moi", tokenSource: "keyring", scopes, gitProtocol: "https", ...extra });
const askedOf = (answers) => {
  const asked = [];
  const run = async (cmd, args) => {
    asked.push(`${cmd} ${args.join(" ")}`);
    return answers(args);
  };
  return { run, asked };
};
{
  const r = await deleteRight(askedOf(() => signedIn("delete_repo, gist, read:org, repo, workflow")).run);
  check("gh signed in with delete_repo: the right is there", r.ok === true && r.account === "moi", JSON.stringify(r));
}
{
  const r = await deleteRight(askedOf(() => signedIn("gist, read:org, repo, workflow")).run);
  check("without delete_repo: the right is missing, and gh can be asked for it", r.ok === false && !r.fromEnvironment, JSON.stringify(r));
}
{
  const r = await deleteRight(askedOf(() => signedIn("repo, read:org", { tokenSource: "GH_TOKEN" })).run);
  check("... a token an environment variable gives: missing, and said (gh cannot refresh it)", r.ok === false && r.fromEnvironment === true, JSON.stringify(r));
}
{
  const r = await deleteRight(askedOf(() => signedIn("", { tokenSource: "GITHUB_TOKEN" })).run);
  check("a sign-in that lists no right (a fine-grained token): unknown, never taken for a yes", r.ok === null && /rights/.test(r.reason), JSON.stringify(r));
}
{
  const r = await deleteRight(askedOf(() => statusJson({ state: "error", active: true, host: "github.com", login: "moi" })).run);
  check("a sign-in gh reports broken: unknown", r.ok === null && /not signed in/.test(r.reason), JSON.stringify(r));
}
{
  const r = await deleteRight(askedOf(() => ({ code: 0, stdout: JSON.stringify({ hosts: {} }), stderr: "" })).run);
  check("gh signed in nowhere (its JSON always exits 0): unknown", r.ok === null, JSON.stringify(r));
}
{
  // A gh too old for --json: the same status in words, as gh 2.40 and later write it.
  const words = (said, code = 0) => (args) => (args.includes("--json") ? { code: 1, stdout: "", stderr: "unknown flag: --json" } : { code, stdout: said, stderr: "" });
  const g = askedOf(words("github.com\n  ✓ Logged in to github.com account moi (keyring)\n  - Active account: true\n  - Token scopes: 'delete_repo', 'gist', 'read:org', 'repo'\n"));
  let r = await deleteRight(g.run);
  check("an older gh, read in words: the right is there", r.ok === true && r.account === "moi" && g.asked.length === 2, JSON.stringify({ r, asked: g.asked }));
  r = await deleteRight(askedOf(words("github.com\n  ✓ Logged in to github.com as moi (oauth_token)\n  ✓ Token scopes: gist, read:org, repo\n")).run);
  check("... and missing, in the words of a still older gh", r.ok === false && r.account === "moi", JSON.stringify(r));
  r = await deleteRight(askedOf(words("github.com\n  ✓ Logged in to github.com account moi (GH_TOKEN)\n  - Token scopes: 'repo'\n")).run);
  check("... a token an environment variable gives is said there too", r.ok === false && r.fromEnvironment === true, JSON.stringify(r));
  r = await deleteRight(askedOf(words("You are not logged into any GitHub hosts. To log in, run: gh auth login\n", 1)).run);
  check("... and gh signed out: unknown", r.ok === null, JSON.stringify(r));
}
{
  const g = askedOf(() => signedIn("repo"));
  const guessed = { ...FOUND, foundVia: undefined, guessed: true };
  await settleGithubDeletion(guessed, [BOOT], g.run);
  check("the inventory says why a repository stays a manual step, without asking gh anything", guessed.deletion?.deletable === false && !guessed.deletion?.right && g.asked.length === 0, JSON.stringify({ deletion: guessed.deletion, asked: g.asked }));
  const mine = { ...FOUND };
  await settleGithubDeletion(mine, [BOOT], g.run);
  check("... and for the repository the skill deletes, whether gh has the right (asked before the execution)", mine.deletion?.deletable === true && mine.deletion?.right?.ok === false, JSON.stringify(mine.deletion));
}

// ── The execution, run for real against a stand-in for gh ──
const EXECUTE = join(ROOT, "scripts", "delete-project", "execute-deletions.mjs");
const work = mkdtempSync(join(tmpdir(), "hv-delete-github-"));
try {
  const standIn = join(work, "faux-gh.mjs");
  writeFileSync(standIn, `import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const dir = process.env.HV_FAKE_GH_DIR;
appendFileSync(dir + "/appels.log", args.join(" ") + "\\n");
const scene = JSON.parse(readFileSync(dir + "/scene.json", "utf8"));
const gone = existsSync(dir + "/supprime");
const notFound = "GraphQL: Could not resolve to a Repository with the name '" + (args[2] ?? "") + "'. (repository)";
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ hosts: { "github.com": [{ state: "success", active: true, host: "github.com", login: "moi", tokenSource: scene.source ?? "keyring", scopes: scene.scopes }] } }));
  process.exit(0);
}
if (args[0] === "repo" && args[1] === "delete") {
  if (scene.alreadyGone) { process.stderr.write("HTTP 404: Not Found (https://api.github.com/repos/" + args[2] + ")"); process.exit(1); }
  if (scene.refuse) { process.stderr.write("HTTP 403: Must have admin rights to Repository. (https://api.github.com/repos/" + args[2] + ")"); process.exit(1); }
  if (!scene.lingers) writeFileSync(dir + "/supprime", args[2]);
  process.exit(0);
}
if (args[0] === "repo" && args[1] === "view") {
  if (gone || scene.alreadyGone) { process.stderr.write(notFound); process.exit(1); }
  process.stdout.write(JSON.stringify({ name: "site" }));
  process.exit(0);
}
process.stderr.write("unexpected: " + args.join(" "));
process.exit(1);
`);
  const home = mkdtempSync(join(work, "maison-"));
  let n = 0;
  const execute = (inventory, scope, scene) => {
    const dir = mkdtempSync(join(work, `cas-${(n += 1)}-`));
    writeFileSync(join(dir, "scene.json"), JSON.stringify(scene));
    const file = join(dir, "inventaire.json");
    writeFileSync(file, JSON.stringify(inventory));
    const env = { ...process.env, HYPERVIBE_GH_BIN: standIn, HV_FAKE_GH_DIR: dir, HOME: home, USERPROFILE: home };
    const r = spawnSync(process.execPath, [EXECUTE, "--inventory", file, "--scope", JSON.stringify(scope), "--confirm", inventory.project], { env, encoding: "utf8", windowsHide: true, timeout: 60000 });
    let report = null;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      report = null;
    }
    const calls = existsSync(join(dir, "appels.log")) ? readFileSync(join(dir, "appels.log"), "utf8").trim().split("\n").filter(Boolean) : [];
    return { code: r.status, report, calls, deleted: existsSync(join(dir, "supprime")) ? readFileSync(join(dir, "supprime"), "utf8") : null, said: `${r.stderr}`.slice(-400) };
  };
  const inventory = (github = FOUND, resources = [BOOT]) => ({ project: "site", github: { ...github }, manifest: { found: true, resources } });
  const RIGHT = { scopes: "delete_repo, repo, read:org" };
  const deletesRepo = (r) => r.calls.some((c) => c.startsWith("repo delete"));

  let r = execute(inventory(), ["github"], RIGHT);
  check("the repository /bootstrap created: deleted by its name, with --yes, the right read first", r.code === 0 && r.calls.includes("repo delete Acme/Site --yes") && r.calls[0].startsWith("auth status") && r.deleted === "Acme/Site", JSON.stringify(r));
  check("... reported deleted, and checked gone afterwards", r.report?.deleted?.github?.results?.[0]?.status === "deleted" && r.report.deleted.github.results[0].verified === true, JSON.stringify(r.report?.deleted?.github));

  r = execute(inventory(), ["all"], RIGHT);
  check("« delete everything » includes it", r.code === 0 && r.deleted === "Acme/Site" && r.report?.deleted?.github?.status === "deleted", JSON.stringify(r));

  r = execute(inventory(), ["vercel"], RIGHT);
  check("kept by the person (not in the scope): gh is not even asked", r.code === 0 && r.calls.length === 0 && r.report?.skipped?.github?.reason === "not in scope", JSON.stringify(r));

  r = execute(inventory({ ...FOUND, foundVia: undefined, guessed: true, deletion: { deletable: true, repository: "Acme/Site" } }), ["github"], RIGHT);
  check("a guessed repository is never deleted, even when the inventory file says it may be", r.code === 0 && !deletesRepo(r) && r.deleted === null && r.report?.skipped?.github?.manual === true, JSON.stringify(r));

  r = execute(inventory(FOUND, [{ ...BOOT, addedBy: "adopt" }]), ["github"], RIGHT);
  check("a repository the manifest has from elsewhere than /bootstrap: a manual step, with the address to open", r.code === 0 && !deletesRepo(r) && r.report?.skipped?.github?.manual === true && r.report.skipped.github.url === FOUND.url, JSON.stringify(r));

  r = execute(inventory(), ["github"], { scopes: "repo, read:org" });
  check("gh without delete_repo: nothing is asked of GitHub, the report names the right to add", r.code === 0 && !deletesRepo(r) && r.report?.failed?.github?.needsScope === "delete_repo" && r.report.failed.github.manual === true, JSON.stringify(r));

  r = execute(inventory(), ["github"], { scopes: "repo", source: "GH_TOKEN" });
  check("... and says when gh's token comes from an environment variable (no refresh possible)", !deletesRepo(r) && r.report?.failed?.github?.fromEnvironment === true, JSON.stringify(r.report?.failed?.github));

  r = execute(inventory(), ["github"], { scopes: "" });
  check("gh that cannot say its rights: nothing deleted, a manual step", !deletesRepo(r) && r.report?.failed?.github?.manual === true && !r.report.failed.github.needsScope, JSON.stringify(r.report?.failed?.github));

  r = execute(inventory(), ["github"], { ...RIGHT, refuse: true });
  check("GitHub refuses (no admin right on the repository): failed, said, a manual step", r.code === 0 && /admin rights/.test(r.report?.failed?.github?.error ?? "") && r.report.failed.github.manual === true, JSON.stringify(r.report?.failed?.github));

  r = execute(inventory(), ["github"], { ...RIGHT, lingers: true });
  check("a deletion GitHub accepted but that cannot be seen afterwards: deleted, not verified", r.report?.deleted?.github?.results?.[0]?.status === "deleted" && r.report.deleted.github.results[0].verified === false, JSON.stringify(r.report?.deleted?.github));

  r = execute(inventory(), ["github"], { ...RIGHT, alreadyGone: true });
  check("a repository already gone: said absent, not a failure", r.code === 0 && r.report?.deleted?.github?.results?.[0]?.status === "absent", JSON.stringify(r.report));

  r = execute({ project: "site", github: { ...FOUND } }, ["github"], RIGHT);
  check("an inventory without the manifest's word: nothing deleted", !deletesRepo(r) && r.report?.skipped?.github?.manual === true, JSON.stringify(r.report?.skipped?.github));
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

// ── What the scripts and the skill say ──
const discover = readFileSync(join(ROOT, "scripts", "delete-project", "discover-resources.mjs"), "utf8");
check("the inventory settles the repository after reading the manifest", discover.indexOf("await settleGithubDeletion(github, manifestReport?.resources ?? [], runCmd)") > discover.indexOf("const manifestReport = await reconcileManifest();") && discover.indexOf("const manifestReport = await reconcileManifest();") > 0);
check("... and a repository the manifest declares and the folder pushes to is said declared and seen", /r\.kind === "github-repo"\) \{[\s\S]{0,200}if \(sameRepository\(github, r\.name\)\) \{\s*github\.declared = true;\s*status = "seen-in-scan";/.test(discover));
const exec = readFileSync(EXECUTE, "utf8");
check("the execution deletes the repository last, after the memory", exec.indexOf('if (scopeSet.has("github"))') > exec.indexOf('if (scopeSet.has("memory"))') && exec.indexOf('if (scopeSet.has("memory"))') > 0);
const skill = readFileSync(join(ROOT, "skills", "delete-project", "SKILL.md"), "utf8");
check("the skill asks gh for the right with the person, before the execution", /gh auth refresh -h github\.com -s delete_repo/.test(skill) && skill.indexOf("gh auth refresh -h github.com -s delete_repo") < skill.indexOf("## Phase 3"));
check("... offers to keep the code repository, and lists the github category", /Keep the code repository/.test(skill) && /"memory","github"\]/.test(skill));
for (const doc of ["DOC.md", "DOC.fr.md"]) {
  const text = readFileSync(join(ROOT, "skills", "delete-project", doc), "utf8");
  check(`${doc} says which repository is deleted, and that /bootstrap made it`, /\/bootstrap/.test(text) && /delete_repo/.test(text), doc);
}

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) process.exit(1);
