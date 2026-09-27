#!/usr/bin/env node
// own-address.mjs - Which *.vercel.app addresses are this project's own, and only those.
//
// A project's addresses at Vercel are <project>.vercel.app and its generated aliases,
// <project>-git-<branch>-<scope>.vercel.app and <project>-<9 characters>-<scope>.vercel.app. Any
// other *.vercel.app address belongs to another project, often of the same account, that a
// service or a Worker may call on purpose. Repointing "every vercel.app address" at the new
// domain rewrote the address of a billing API shared by two projects into the project's own
// (outside review, 3.3.2), and a plain prefix test would take atelier-pro.vercel.app, another
// project, for an alias of atelier. The same test as the Stripe block of /add-domain, in one
// place, for the Render services and the Workers.
//
//   node own-address.mjs rewrite --project-dir <dir> [--vercel-project <name>] --to-origin https://<domain>
//        reads a text on the standard input (a wrangler.toml), prints ONE JSON object,
//        {project, text, changes: [{from, to}], kept: [address]}: the project's own addresses
//        pointed at <to-origin>, their path kept; any other *.vercel.app address listed in
//        `kept`, never touched. Exit 1, nothing rewritten, when the project's name is unknown or
//        --to-origin is not https://<domain>.
//
// The project's name is the one `vercel link` wrote in .vercel/project.json (projectName), or
// the one given with --vercel-project.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ORIGIN = /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/** The project's name at Vercel, as `vercel link` wrote it; null when unknown. */
export function projectNameOf(projectDir) {
  const file = join(projectDir, ".vercel", "project.json");
  if (!existsSync(file)) return null;
  try {
    const name = JSON.parse(readFileSync(file, "utf8")).projectName;
    return typeof name === "string" && NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** True when `host` is one of the project's own addresses at Vercel. */
export function isProjectHost(host, project) {
  if (!NAME.test(project ?? "")) return false;
  const h = String(host).toLowerCase();
  if (h === `${project}.vercel.app`) return true;
  return new RegExp(`^${project}-(?:git-[a-z0-9-]+|[a-z0-9]{9})-[a-z0-9-]+\\.vercel\\.app$`).test(h);
}

// An address's origin, up to the end of its host name: `https://x.vercel.app.example.com` is not
// a vercel.app address.
const ADDRESS = /https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app)(?![a-z0-9.-])/gi;

/** `text` with the project's own addresses pointed at `toOrigin` (their path kept), and the
 *  other vercel.app addresses it holds, untouched. */
export function repointOwn(text, project, toOrigin) {
  const changes = [];
  const kept = [];
  const out = String(text).replace(ADDRESS, (whole, host) => {
    if (!isProjectHost(host, project)) {
      if (!kept.includes(whole)) kept.push(whole);
      return whole;
    }
    changes.push({ from: whole, to: toOrigin });
    return toOrigin;
  });
  return { text: out, changes, kept };
}

export function checkOrigin(toOrigin) {
  return ORIGIN.test(toOrigin ?? "");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const fail = (message) => {
    console.log(JSON.stringify({ error: message }));
    process.exit(1);
  };
  if (args[0] !== "rewrite") fail("Usage: own-address.mjs rewrite --project-dir <dir> [--vercel-project <name>] --to-origin https://<domain> < file");
  const toOrigin = flag("--to-origin");
  if (!checkOrigin(toOrigin)) fail("--to-origin must be https://<domain>, nothing after the domain: nothing was rewritten.");
  const project = flag("--vercel-project") ?? projectNameOf(resolve(flag("--project-dir") ?? "."));
  if (!NAME.test(project ?? "")) {
    fail("The project's name at Vercel is unknown (no projectName in .vercel/project.json): pass --vercel-project <name>. Nothing was rewritten.");
  }
  const out = repointOwn(readFileSync(0, "utf8"), project, toOrigin);
  console.log(JSON.stringify({ project, ...out }));
}
