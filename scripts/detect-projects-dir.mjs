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
// Usage:
//   node detect-projects-dir.mjs [--cwd <path>]
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
// `recommended` is a HINT, never an order:
//   - exactly one existing candidate holds projects -> that one
//   - none holds a project but one exists           -> that one
//   - nothing exists                                -> the OS convention (to create)
//   - several hold projects                         -> `ambiguous: true`, the skill
//     MUST ask the user (see SKILL.md, Step 2 sub-step 1).
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const cwdArg = args.includes("--cwd")
  ? args[args.indexOf("--cwd") + 1]
  : process.cwd();
// --home : profil simulé, pour tester la détection sans toucher au vrai Bureau.
const homeArg = args.includes("--home")
  ? args[args.indexOf("--home") + 1]
  : null;

const HOME = homeArg ? resolve(homeArg) : homedir();
const PLAT = platform();
const isWin = PLAT === "win32";

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
function userRoots() {
  const roots = [HOME];
  try {
    for (const e of readdirSync(HOME, { withFileTypes: true })) {
      if (e.isDirectory() && /^(OneDrive|Dropbox|iCloudDrive)/i.test(e.name)) {
        roots.push(join(HOME, e.name));
      }
    }
  } catch {
    /* profil illisible : on garde HOME seul */
  }
  return roots;
}

const candidates = [];
const seen = new Set();
const add = (p, source) => {
  if (!p) return;
  const abs = resolve(p);
  const key = abs.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  const exists = isDir(abs);
  candidates.push({
    path: abs,
    exists,
    projectCount: exists ? countProjects(abs) : 0,
    source,
  });
};

// 1. The convention documented in the course. (Under --home the convention is
// rebased inside the simulated profile, so tests stay hermetic.)
if (isWin) add(homeArg ? join(HOME, "DEV") : "C:\\DEV", "convention");
else add(join(HOME, "dev"), "convention");

// 2. Desktop / Documents variants - where participants spontaneously create it.
for (const root of userRoots()) {
  for (const holder of ["Desktop", "Bureau", "Documents"]) {
    for (const name of ["DEV", "dev", "Dev", "projets", "projects"]) {
      add(
        join(root, holder, name),
        holder === "Documents" ? "documents" : "desktop",
      );
    }
  }
}

// 3. Other common homes for a projects folder.
for (const name of ["dev", "Dev", "DEV", "projects", "projets", "code", "src"]) {
  add(join(HOME, name), "home");
}

const existing = candidates.filter((c) => c.exists);
const withProjects = existing.filter((c) => c.projectCount > 0);

let recommended;
let ambiguous = false;
if (withProjects.length === 1) {
  recommended = withProjects[0].path;
} else if (withProjects.length > 1) {
  ambiguous = true;
  recommended = [...withProjects].sort((a, b) => b.projectCount - a.projectCount)[0]
    .path;
} else if (existing.length === 1) {
  recommended = existing[0].path;
} else if (existing.length > 1) {
  ambiguous = true;
  recommended = existing[0].path;
} else {
  recommended = candidates[0].path; // rien n'existe : la convention, à créer
}

const cwdAbs = resolve(cwdArg);
process.stdout.write(
  JSON.stringify(
    {
      platform: PLAT,
      cwd: {
        path: cwdAbs,
        insideProject: looksLikeProject(cwdAbs),
        projectCount: countProjects(cwdAbs),
      },
      candidates: candidates
        .filter((c) => c.exists || c.source === "convention")
        .sort(
          (a, b) =>
            Number(b.exists) - Number(a.exists) || b.projectCount - a.projectCount,
        ),
      recommended,
      ambiguous,
    },
    null,
    2,
  ) + "\n",
);
