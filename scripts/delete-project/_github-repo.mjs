// _github-repo.mjs - The project's GitHub repository, as /delete-project designates it.
//
// It is the repository the project's folder pushes to (origin). The inventory used to look for
// "the signed-in account + the project's name": it designated a homonym in the person's account
// and missed a repository of an organisation, and a read that failed was taken for "no
// repository", so the manual deletion step disappeared (lot 7 inventory, 06/10/2026). The
// account-and-name lookup remains only when the folder pushes nowhere, said as a guess.
//
// Since 3.4.9 /delete-project deletes ONE repository itself: the one /bootstrap created for this
// project and wrote in its manifest, which is also the one the folder pushes to
// (repositoryToDelete). Any other stays a manual step, as before: a repository holds the code and
// its whole history, and none is deleted on a guess. gh needs the `delete_repo` right for it,
// which it does not have by default (deleteRight).
//
// Not a CLI: scripts/tests/test-delete-github.mjs holds it.

import { projectRepository } from "./_render-match.mjs";

/**
 * @param {{projectDir: string, project: string,
 *          run: (cmd: string, args: string[]) => Promise<{code: number, stdout: string, stderr: string}>,
 *          origin?: (dir: string) => string|null}} deps
 * @returns {Promise<object>} `exists`, and `foundVia: "origin"` or `guessed: true`; `error` when a
 *          read failed (never "no repository"), `skipped` when the folder pushes elsewhere.
 */
export async function githubRepositoryOf({ projectDir, project, run, origin = projectRepository }) {
  try {
    let full = null;
    let guessed = false;
    const repository = origin(projectDir); // "host/owner/name", lowercased
    if (repository) {
      const [host, owner, name] = repository.split("/");
      if (host !== "github.com") return { exists: false, skipped: `the project's folder pushes to ${host}, not to GitHub` };
      full = `${owner}/${name}`;
    } else {
      const who = await run("gh", ["api", "user", "--jq", ".login"]);
      const owner = (who.stdout || "").trim();
      if (who.code !== 0 || !owner) {
        return { exists: false, error: "the project's folder pushes to no repository, and gh could not say which account is signed in: the repository was not looked for" };
      }
      full = `${owner}/${project}`;
      guessed = true;
    }
    const r = await run("gh", ["repo", "view", full, "--json", "name,nameWithOwner,url,visibility,isPrivate"]);
    if (r.code !== 0) {
      const said = `${r.stderr || ""}${r.stdout || ""}`.trim();
      // gh answers "Could not resolve to a Repository" for one that does not exist; anything else
      // (signed out, network, rights) is an error.
      if (/Could not resolve to a Repository|HTTP 404/i.test(said)) return { exists: false, looked: full, ...(guessed ? { guessed: true } : {}) };
      return { exists: false, looked: full, error: said.slice(0, 300) || `gh exited with ${r.code}` };
    }
    return { exists: true, ...JSON.parse(r.stdout), ...(guessed ? { guessed: true } : { foundVia: "origin" }) };
  } catch (e) {
    return { exists: false, error: String(e?.message ?? e) };
  }
}

/**
 * Whether /delete-project deletes the repository itself: only the one /bootstrap created for this
 * project and declared in its manifest, which is also the one the project's folder pushes to. A
 * repository found otherwise (by the signed-in account and the project's name, adopted from the
 * folder's remote, declared by another skill, named otherwise by the manifest, or shared) stays a
 * manual step. Decided from the inventory's facts alone: execute-deletions.mjs decides again
 * before deleting, and never trusts a flag the inventory carries.
 * @param {object} github the inventory's `github` section (githubRepositoryOf)
 * @param {object[]} declared the resources the project's manifest declares
 * @returns {{deletable: true, repository: string} | {deletable: false, reason: string}}
 */
export function repositoryToDelete(github, declared = []) {
  if (!github?.exists) return { deletable: false, reason: "no repository was found" };
  if (github.guessed === true || github.foundVia !== "origin") {
    return { deletable: false, reason: "the repository was found by the signed-in account and the project's name, not by the project's folder: none is deleted on a guess" };
  }
  const full = String(github.nameWithOwner ?? "");
  const repos = (Array.isArray(declared) ? declared : []).filter((r) => r?.kind === "github-repo");
  const same = repos.find((r) => sameRepository(github, r.name));
  if (!same) {
    return {
      deletable: false,
      reason: repos.length
        ? `the project's manifest declares ${repos.map((r) => r.name).join(", ")}, and the folder pushes to ${full || "a repository gh did not name"}`
        : "the project's manifest does not declare this repository",
    };
  }
  if (same.shared === true) return { deletable: false, reason: "the project's manifest declares this repository shared with other projects" };
  if (same.addedBy !== "bootstrap") {
    return { deletable: false, reason: `the project's manifest has this repository from ${same.addedBy ? `"${same.addedBy}"` : "an unknown source"}, not from /bootstrap: only a repository /bootstrap created is deleted here` };
  }
  return { deletable: true, repository: full };
}

/** Whether a name the manifest declares is the repository the inventory found, as GitHub names
 *  it (GitHub's names ignore case). */
export function sameRepository(github, name) {
  const full = String(github?.nameWithOwner ?? "").toLowerCase();
  return Boolean(github?.exists && full && String(name ?? "").toLowerCase() === full);
}

const ENVIRONMENT_TOKENS = /\b(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)\b/;

/**
 * Whether gh may delete a repository: the `delete_repo` right of the account gh is signed in to
 * on github.com, read from `gh auth status` (its JSON when gh has it, its words otherwise). Never
 * the token itself.
 * @param {(cmd: string, args: string[]) => Promise<{code: number, stdout: string, stderr: string}>} run
 * @returns {Promise<object>} `ok: true`; `ok: false` when the right is missing (`gh auth refresh -h
 *   github.com -s delete_repo` adds it, unless `fromEnvironment`: gh then uses a token an
 *   environment variable gives, which it cannot refresh); `ok: null` when it cannot be told.
 */
export async function deleteRight(run) {
  let account = null;
  let source = null;
  let scopes = null;
  let parsed = null;
  try {
    const r = await run("gh", ["auth", "status", "--hostname", "github.com", "--json", "hosts"]);
    parsed = r.code === 0 ? JSON.parse(r.stdout) : null;
  } catch {
    parsed = null;
  }
  if (parsed?.hosts && typeof parsed.hosts === "object") {
    const entries = Array.isArray(parsed.hosts["github.com"]) ? parsed.hosts["github.com"] : [];
    const active = entries.find((h) => h?.active) ?? entries[0];
    if (!active || active.state !== "success") return { ok: null, reason: "gh is not signed in to github.com" };
    account = active.login ?? null;
    source = active.tokenSource ?? null;
    scopes = active.scopes ?? null;
  } else {
    // A gh too old for --json: the same status, in words.
    let r;
    try {
      r = await run("gh", ["auth", "status", "--hostname", "github.com"]);
    } catch (e) {
      return { ok: null, reason: `gh could not be asked (${String(e?.message ?? e).slice(0, 120)})` };
    }
    if (r.code !== 0) return { ok: null, reason: "gh is not signed in to github.com" };
    const said = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    account = /Logged in to github\.com (?:account|as) (\S+)/i.exec(said)?.[1] ?? null;
    source = ENVIRONMENT_TOKENS.exec(said)?.[0] ?? null;
    scopes = /Token scopes:\s*(.*)/i.exec(said)?.[1] ?? null;
  }
  const list = String(scopes ?? "").replace(/['"]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("delete_repo")) return { ok: true, account };
  if (!list.length) return { ok: null, account, reason: "gh does not say which rights this sign-in has (a token an environment variable gives, for instance)" };
  return { ok: false, account, ...(ENVIRONMENT_TOKENS.test(String(source ?? "")) ? { fromEnvironment: true } : {}) };
}

/**
 * The inventory's word on the repository, written into its `github` section: `deletion` says
 * whether /delete-project deletes it (and why not), and, when it would, whether gh has the right
 * (read now, so that the person is asked for it before the execution, never in the middle of it).
 */
export async function settleGithubDeletion(github, declared, run) {
  if (!github || typeof github !== "object") return github;
  github.deletion = repositoryToDelete(github, declared);
  if (github.deletion.deletable) github.deletion.right = await deleteRight(run);
  return github;
}
