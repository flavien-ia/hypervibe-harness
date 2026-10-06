#!/usr/bin/env node
// test-delete-github.mjs - The repository /delete-project lists for manual deletion is the one the
// project's folder pushes to, and a read that failed is said, never taken for "no repository"
// (lot 7 inventory, 06/10/2026). Against a fake gh: nothing reaches the forge.
//
//   node scripts/tests/test-delete-github.mjs

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { githubRepositoryOf } = await import(pathToFileURL(join(ROOT, "scripts", "delete-project", "_github-repo.mjs")).href);

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

console.log(`\n${checks - failures}/${checks} checks`);
if (failures) process.exit(1);
