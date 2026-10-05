#!/usr/bin/env node
// test-render-match.mjs - /delete-project finds a project's Render service by its name or by the
// repository it is built from, on every page of the account.
//
// An agent's service carried the agent's name alone: /delete-project looked for the project's
// name, read one page of the account, and the service kept running, and billing, after its
// project was gone (lot 6 bis, 05/10/2026). No network: the helpers are pure, and the inventory
// script is read for what it calls.
//
//   node scripts/tests/test-render-match.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { matchOf, projectRepository, repositoryOf } = await import(pathToFileURL(join(ROOT, "scripts", "delete-project", "_render-match.mjs")).href);
const { tokenMatches } = await import(pathToFileURL(join(ROOT, "scripts", "_match.mjs")).href);

let checks = 0;
let failures = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${!ok && detail ? ` (${String(detail).slice(0, 200)})` : ""}`);
}

console.log("── Un dépôt, sous toutes ses écritures ──");
check("https, with or without .git, with a trailing slash: the same repository", repositoryOf("https://github.com/Equipe/Atelier") === "github.com/equipe/atelier" && repositoryOf("https://github.com/equipe/atelier.git") === "github.com/equipe/atelier" && repositoryOf("https://github.com/equipe/atelier/") === "github.com/equipe/atelier");
check("ssh (git@host:owner/name) and ssh://", repositoryOf("git@github.com:equipe/atelier.git") === "github.com/equipe/atelier" && repositoryOf("ssh://git@github.com/equipe/atelier.git") === "github.com/equipe/atelier");
check("another forge keeps its host (gitlab.com is not github.com)", repositoryOf("https://gitlab.com/equipe/atelier") === "gitlab.com/equipe/atelier");
check("nothing to read: null, never a guess", repositoryOf("") === null && repositoryOf(undefined) === null && repositoryOf("atelier") === null);

console.log("\n── Le service d'un projet : par son nom, ou par son dépôt ──");
const ctx = { projectLower: "atelier", repository: "github.com/equipe/atelier", tokenMatches };
check("a service whose name carries the project's: by its name", matchOf({ name: "atelier-worker" }, ctx) === "name");
check("an agent's service named after the agent alone, built from the project's repository: by its repository", matchOf({ name: "veille", repo: "https://github.com/equipe/atelier" }, ctx) === "repository");
check("another project's service, from another repository: not the project's", matchOf({ name: "veille", repo: "https://github.com/equipe/autre" }, ctx) === null);
check("a repository whose name only starts like the project's: not the project's", matchOf({ name: "veille", repo: "https://github.com/equipe/atelier-pro" }, ctx) === null);
check("the project's repository unknown: only its name counts", matchOf({ name: "veille", repo: "https://github.com/equipe/atelier" }, { ...ctx, repository: null }) === null);

console.log("\n── Le dépôt du projet, lu dans son dossier ──");
const fakeGit = (status, stdout) => () => ({ status, stdout });
check("the remote of the project's folder", projectRepository("x", fakeGit(0, "git@github.com:equipe/atelier.git\n")) === "github.com/equipe/atelier");
check("a folder without a remote: null", projectRepository("x", fakeGit(2, "")) === null);
check("git that cannot be run: null, never an exception", projectRepository("x", () => { throw new Error("no git"); }) === null);

console.log("\n── L'inventaire de /delete-project s'en sert ──");
const inventory = readFileSync(join(ROOT, "scripts", "delete-project", "discover-resources.mjs"), "utf8");
const scan = inventory.slice(inventory.indexOf("async function scanRender()"), inventory.indexOf("// ─── 8."));
check("it reads every page of the account (a cursor), never one", /cursor/.test(scan) && !/services\?limit=100"/.test(scan));
check("it matches by name or by repository, through the helper", /matchOf\(/.test(scan) && /projectRepository\(PROJECT_DIR\)/.test(scan));
check("a service found by its repository says so", /foundVia: "repository"/.test(scan));
const skill = readFileSync(join(ROOT, "skills", "delete-project", "SKILL.md"), "utf8");
check("the skill says what a service found by its repository is", /foundVia: "repository"/.test(skill));

console.log(`\n${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
