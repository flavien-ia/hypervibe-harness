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

// Vercel CLI auth file location varies by OS AND by CLI version. Older versions
// nested it under `Data/auth.json` (Cocoa app convention), then moved it to the
// app-support folder directly, and v59 (2026-08) moved it again to an XDG-style
// `xdg.data/com.vercel.cli/` folder - on Windows too, under APPDATA, even with
// XDG_DATA_HOME unset. We list every known location per platform; the caller
// picks the most recently written one (see loadAuthToken).
export function getAuthFilePathCandidates() {
  const os = platform();
  if (os === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return [
      join(appData, "xdg.data", "com.vercel.cli", "auth.json"),
      join(appData, "com.vercel.cli", "Data", "auth.json"),
      join(appData, "com.vercel.cli", "auth.json"),
    ];
  }
  if (os === "darwin") {
    const base = join(homedir(), "Library", "Application Support", "com.vercel.cli");
    return [
      join(homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
      join(base, "Data", "auth.json"),
      join(base, "auth.json"),
    ];
  }
  // Linux / other POSIX
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return [
    join(xdg, "com.vercel.cli", "Data", "auth.json"),
    join(xdg, "com.vercel.cli", "auth.json"),
  ];
}

// Returns the Vercel API token, or null when the CLI is not logged in.
// `onWarn` receives a human-readable line when a candidate file exists but is unreadable.
//
// When several auth files exist (a CLI update moved the location, leaving the
// old file behind), the MOST RECENTLY WRITTEN one wins: the CLI refreshes its
// token in place, so the freshest file is the live one and the others are
// frozen with dead tokens. First-found is exactly how a stale file shadows a
// valid login (seen on 2026-08-17, after the v59 path move).
export function loadAuthToken({ onWarn } = {}) {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  let best = null;
  for (const p of getAuthFilePathCandidates()) {
    try {
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, "utf8"));
      if (!data.token) continue;
      // Don't pre-check expiry - let the API return 401 if the token is truly dead.
      // Pre-checks are unreliable: clocks drift, Vercel uses grace periods, and
      // the refreshToken can silently extend the session.
      const mtime = statSync(p).mtimeMs;
      if (!best || mtime > best.mtime) best = { token: data.token, mtime };
    } catch (err) {
      if (onWarn) onWarn(`Could not read ${p} (${err.message}) - trying next candidate.`);
    }
  }
  return best ? best.token : null;
}

// Reads .vercel/project.json from a project directory.
// Returns { projectId, orgId } or null when the project is not linked.
export function readLinkedProject(projectDir = process.cwd()) {
  const p = join(projectDir, ".vercel", "project.json");
  if (!existsSync(p)) return null;
  try {
    const project = JSON.parse(readFileSync(p, "utf8"));
    if (!project.projectId) return null;
    return { projectId: project.projectId, orgId: project.orgId || null };
  } catch {
    return null;
  }
}
