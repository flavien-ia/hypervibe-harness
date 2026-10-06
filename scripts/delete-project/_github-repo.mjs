// _github-repo.mjs - The project's GitHub repository, as /delete-project designates it.
//
// It is the repository the project's folder pushes to (origin). The inventory used to look for
// "the signed-in account + the project's name": it designated a homonym in the person's account
// and missed a repository of an organisation, and a read that failed was taken for "no
// repository", so the manual deletion step disappeared (lot 7 inventory, 06/10/2026). The
// account-and-name lookup remains only when the folder pushes nowhere, said as a guess.
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
