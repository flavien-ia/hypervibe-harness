#!/usr/bin/env node
// detect-projects-dir.mjs - /bootstrap parent-folder guard.
//
// WHY THIS EXISTS
// /bootstrap used to hardcode `cd /c/DEV` and create that folder when missing.
// Participants who had carefully made their own `DEV` folder (very often on the
// Desktop - named "Bureau" on a French Windows, and frequently redirected into
// OneDrive) ended up with TWO folders: theirs, empty, and a brand-new C:\DEV
// holding the project. Nothing told them, so they looked for their app in the
// wrong place.
//
// So we stop guessing: we look at where this machine ALREADY keeps projects and
// let the skill confirm with the user before anything is created.
//
// The folder the user is working in counts too: when it, or its parent, already
// holds projects, it is a candidate, whatever its name. A folder named freely
// (`C:\DEV CLAUDE CODE\PRO`, which held projects) used to be ignored in favour of
// a C:\DEV that did not exist (ticket of 30/09/2026).
//
// Usage:
//   node detect-projects-dir.mjs [--cwd <path>] [--home <path>]
//
// A path may come as Git Bash writes it (`/c/DEV CLAUDE CODE/PRO`, from
// `--cwd "$(pwd)"`): under Windows it is read as `C:\DEV CLAUDE CODE\PRO`. Node's
// resolve() alone would make it `C:\c\DEV CLAUDE CODE\PRO`.
//
// Output: one JSON object on stdout. A missing or unreadable folder is never an
// error (exit 0 always).
//
//   {
//     "platform": "win32",
//     "cwd": { "path": "...", "insideProject": true, "projectCount": 0 },
//     "candidates": [
//       { "path": "C:\\DEV", "exists": true, "projectCount": 7, "source": "convention" },
//       { "path": "C:\\Users\\x\\OneDrive\\Bureau\\DEV", "exists": true, "projectCount": 0, "source": "desktop" }
//     ],
//     "recommended": "C:\\DEV",
//     "ambiguous": false
//   }
//
// `source`: convention, desktop, documents, home, cwd (the folder the user is in)
// or cwd-parent (its parent, when the user is inside a project or beside others).
//
// `recommended` is a HINT, never an order:
//   - exactly one existing candidate holds projects -> that one
//   - several hold projects                         -> `ambiguous: true`, the skill
//     MUST ask the user (see SKILL.md, Step 2 sub-step 1); the hint is the folder
//     the user is in when it is one of them, else the one with the most projects
//   - none holds a project but one exists           -> that one
//   - nothing exists                                -> the OS convention (to create)
// A folder that does not exist is never recommended while an existing one holds
// projects.
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A path as Git Bash writes it (`/c/...`, or `/cygdrive/c/...`), made a Windows path under
 *  Windows; any other path, and any path elsewhere, unchanged. */
export function fromGitBashPath(p, win = platform() === "win32") {
  if (!win || typeof p !== "string") return p;
  const m = /^\/(?:cygdrive\/)?([a-zA-Z])(?:\/(.*))?$/.exec(p);
  if (!m) return p;
  return `${m[1].toUpperCase()}:\\${(m[2] ?? "").split("/").filter(Boolean).join("\\")}`;
}

/** A child folder that looks like a real project (a repo or a Node app). */
function looksLikeProject(dir) {
  try {
    return existsSync(join(dir, "package.json")) || existsSync(join(dir, ".git"));
  } catch {
    return false;
  }
}

/** How many direct children of `dir` look like projects (0 if unreadable). */
function countProjects(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        looksLikeProject(join(dir, e.name)),
    ).length;
  } catch {
    return 0;
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Profile roots to scan: the home folder plus any OneDrive* / Dropbox* folder,
 * so a Desktop redirected into a sync tool is still found. That redirection is
 * exactly what made the original bug invisible.
 */
function userRoots(home) {
  const roots = [home];
  try {
    for (const e of readdirSync(home, { withFileTypes: true })) {
      if (e.isDirectory() && /^(OneDrive|Dropbox|iCloudDrive)/i.test(e.name)) {
        roots.push(join(home, e.name));
      }
    }
  } catch {
    /* profil illisible : on garde HOME seul */
  }
  return roots;
}

/** Where the machine keeps projects, and which folder to suggest. `home` simulates a profile
 *  (the recettes: nothing of the real Desktop is read). */
export function detect({ cwd = process.cwd(), home = null, plat = platform() } = {}) {
  const isWin = plat === "win32";
  const HOME = home ? resolve(fromGitBashPath(home, isWin)) : homedir();
  const cwdAbs = resolve(fromGitBashPath(cwd, isWin));

  const candidates = [];
  const seen = new Set();
  const add = (p, source, { onlyWithProjects = false } = {}) => {
    if (!p) return;
    const abs = resolve(p);
    const key = abs.toLowerCase();
    if (seen.has(key)) return;
    const exists = isDir(abs);
    const projectCount = exists ? countProjects(abs) : 0;
    if (onlyWithProjects && projectCount === 0) return;
    seen.add(key);
    candidates.push({ path: abs, exists, projectCount, source });
  };

  // 0. The folder the user is in, or its parent, when it already holds projects: whatever its
  // name, it is where this person keeps them. Never the profile itself nor a disk's root (a few
  // repositories there do not make them a projects folder).
  const notAHolder = (p) => {
    const abs = resolve(p);
    return abs.toLowerCase() === resolve(HOME).toLowerCase() || abs === parse(abs).root;
  };
  if (!notAHolder(cwdAbs)) add(cwdAbs, "cwd", { onlyWithProjects: true });
  const parent = dirname(cwdAbs);
  if (parent !== cwdAbs && !notAHolder(parent)) add(parent, "cwd-parent", { onlyWithProjects: true });

  // 1. The convention documented in the course. (Under --home the convention is
  // rebased inside the simulated profile, so tests stay hermetic.)
  if (isWin) add(home ? join(HOME, "DEV") : "C:\\DEV", "convention");
  else add(join(HOME, "dev"), "convention");

  // 2. Desktop / Documents variants - where participants spontaneously create it.
  for (const root of userRoots(HOME)) {
    for (const holder of ["Desktop", "Bureau", "Documents"]) {
      for (const name of ["DEV", "dev", "Dev", "projets", "projects"]) {
        add(join(root, holder, name), holder === "Documents" ? "documents" : "desktop");
      }
    }
  }

  // 3. Other common homes for a projects folder.
  for (const name of ["dev", "Dev", "DEV", "projects", "projets", "code", "src"]) {
    add(join(HOME, name), "home");
  }

  const existing = candidates.filter((c) => c.exists);
  const withProjects = existing.filter((c) => c.projectCount > 0);
  const convention = candidates.find((c) => c.source === "convention");

  let recommended;
  let ambiguous = false;
  if (withProjects.length === 1) {
    recommended = withProjects[0].path;
  } else if (withProjects.length > 1) {
    ambiguous = true;
    const here = withProjects.find((c) => c.source === "cwd") ?? withProjects.find((c) => c.source === "cwd-parent");
    recommended = here ? here.path : [...withProjects].sort((a, b) => b.projectCount - a.projectCount)[0].path;
  } else if (existing.length === 1) {
    recommended = existing[0].path;
  } else if (existing.length > 1) {
    ambiguous = true;
    recommended = existing[0].path;
  } else {
    recommended = (convention ?? candidates[0]).path; // rien n'existe : la convention, à créer
  }

  return {
    platform: plat,
    cwd: {
      path: cwdAbs,
      insideProject: looksLikeProject(cwdAbs),
      projectCount: countProjects(cwdAbs),
    },
    candidates: candidates
      .filter((c) => c.exists || c.source === "convention")
      .sort((a, b) => Number(b.exists) - Number(a.exists) || b.projectCount - a.projectCount),
    recommended,
    ambiguous,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  // --home : profil simulé, pour tester la détection sans toucher au vrai Bureau.
  process.stdout.write(`${JSON.stringify(detect({ cwd: value("--cwd") ?? process.cwd(), home: value("--home") ?? null }), null, 2)}\n`);
}
