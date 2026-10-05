// _render-match.mjs - Whether a Render service is this project's: by its name, or by the
// repository it is built from.
//
// An agent's service used to carry the agent's name alone. /delete-project looked for the
// project's name, never found it, and the service kept running, and billing, after its project
// was gone (lot 6 bis, 05/10/2026). A service built from the project's own repository is the
// project's whatever its name: Render says which repository each service builds from.
//
// Not a CLI: this module only exports helpers (scripts/tests/test-render-match.mjs holds them).

import { spawnSync } from "node:child_process";

/** "host/owner/name" of a git address (https or ssh), lowercased, or null. */
export function repositoryOf(address) {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)([^/:]+)[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(address ?? "").trim());
  return m ? `${m[1]}/${m[2]}/${m[3]}`.toLowerCase() : null;
}

/** The project's repository, read from its folder's git remote (origin), or null. */
export function projectRepository(projectDir, run = spawnSync) {
  try {
    const r = run("git", ["-C", projectDir, "remote", "get-url", "origin"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    return r.status === 0 ? repositoryOf(r.stdout) : null;
  } catch {
    return null;
  }
}

/** How a service is this project's: "name" (its name carries the project's), "repository" (it
 *  is built from the project's repository), or null. */
export function matchOf(service, { projectLower, repository, tokenMatches }) {
  if (tokenMatches(projectLower, service?.name || "")) return "name";
  if (repository && repositoryOf(service?.repo) === repository) return "repository";
  return null;
}
