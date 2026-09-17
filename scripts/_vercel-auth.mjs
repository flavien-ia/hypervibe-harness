#!/usr/bin/env node
// _vercel-auth.mjs - Shared Vercel auth + project resolution helpers.
//
// Extracted from push-env-vars.mjs so every script that talks to the Vercel REST
// API resolves the token and the project the same way (no duplicated OS logic).
//
//   import { loadAuthToken, readLinkedProject } from "./_vercel-auth.mjs";
//
// Not a CLI: this module only exports helpers.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

// The folder where the Vercel CLI keeps its data files (auth.json, config.json)
// varies by OS AND by CLI version. Older versions nested them under `Data/`
// (Cocoa app convention), then moved them to the app-support folder directly,
// and v59 (2026-08) moved them again to an XDG-style `xdg.data/com.vercel.cli/`
// folder - on Windows too, under APPDATA, even with XDG_DATA_HOME unset. The
// move leaves the old files behind, frozen: every reader lists all the known
// folders and keeps the most recently written file (see freshestJson).
export function getCliDataDirCandidates() {
  const os = platform();
  if (os === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return [
      join(appData, "xdg.data", "com.vercel.cli"),
      join(appData, "com.vercel.cli", "Data"),
      join(appData, "com.vercel.cli"),
    ];
  }
  if (os === "darwin") {
    const base = join(homedir(), "Library", "Application Support", "com.vercel.cli");
    return [
      join(homedir(), ".local", "share", "com.vercel.cli"),
      join(base, "Data"),
      base,
    ];
  }
  // Linux / other POSIX
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return [
    join(xdg, "com.vercel.cli", "Data"),
    join(xdg, "com.vercel.cli"),
  ];
}

export function getAuthFilePathCandidates() {
  return getCliDataDirCandidates().map((dir) => join(dir, "auth.json"));
}

export function getConfigFilePathCandidates() {
  return getCliDataDirCandidates().map((dir) => join(dir, "config.json"));
}

// The parsed content of the most recently written candidate that `accept`
// keeps, or null. The CLI rewrites its live files in place, so the freshest one
// is the live one; first-found is exactly how a stale file shadows the real one.
function freshestJson(paths, accept, onWarn) {
  let best = null;
  for (const p of paths) {
    try {
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, "utf8"));
      if (!data || typeof data !== "object" || !accept(data)) continue;
      const mtime = statSync(p).mtimeMs;
      if (!best || mtime > best.mtime) best = { data, mtime };
    } catch (err) {
      if (onWarn) onWarn(`Could not read ${p} (${err.message}) - trying next candidate.`);
    }
  }
  return best ? best.data : null;
}

// Returns the Vercel API token, or null when the CLI is not logged in.
// `onWarn` receives a human-readable line when a candidate file exists but is unreadable.
//
// When several auth files exist, the MOST RECENTLY WRITTEN one holding a token
// wins: the others are frozen with dead tokens (seen on 2026-08-17, after the
// v59 path move).
// Don't pre-check expiry - let the API return 401 if the token is truly dead.
// Pre-checks are unreliable: clocks drift, Vercel uses grace periods, and the
// refreshToken can silently extend the session.
export function loadAuthToken({ onWarn } = {}) {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const data = freshestJson(getAuthFilePathCandidates(), (d) => Boolean(d.token), onWarn);
  return data ? data.token : null;
}

// The team the CLI acts on when a command gets no --scope (config.json
// `currentTeam`), or null when it is set to the personal scope. The freshest
// config file decides, including when it names no team: an older file that
// still names one is exactly the stale answer to avoid (seen on 2026-09-17:
// the pre-v59 file, untouched for a month, was still the first one read).
export function readCliCurrentTeam({ onWarn } = {}) {
  const data = freshestJson(getConfigFilePathCandidates(), () => true, onWarn);
  const team = data && data.currentTeam;
  return typeof team === "string" && team ? team : null;
}

// A link's orgId is a team id (`team_...`) or the id of a personal account.
export function teamIdFromOrgId(orgId) {
  return typeof orgId === "string" && orgId.startsWith("team_") ? orgId : null;
}

// Reads .vercel/project.json from a project directory.
// Returns { projectId, orgId, projectName } or null when the project is not
// linked. `projectName` is only written by recent CLIs (null otherwise).
export function readLinkedProject(projectDir = process.cwd()) {
  const p = join(projectDir, ".vercel", "project.json");
  if (!existsSync(p)) return null;
  try {
    const project = JSON.parse(readFileSync(p, "utf8"));
    if (!project.projectId) return null;
    return {
      projectId: project.projectId,
      orgId: project.orgId || null,
      projectName: typeof project.projectName === "string" ? project.projectName : null,
    };
  } catch {
    return null;
  }
}
