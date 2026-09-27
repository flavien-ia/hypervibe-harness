// layout.mjs - Where a Next.js project keeps its application: `app/` at its root, or `src/app/`.
//
// Next.js ignores src/app as soon as an app/ (or pages/) folder exists at the root of the project
// ("src/app or src/pages will be ignored if app or pages are present in the root directory", its
// documentation). A privacy policy written into src/app of such a project builds without a
// warning, and is never served: the site answers 404 on its own policy while the audit stays
// green (outside review, 3.3.1). The audit, the registry script and the skills that write a page
// all ask this file, so that they choose the folder Next.js serves, the way Next.js chooses it.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The folders of a project: `src` true when its application lives under src/. */
export function projectLayout(webRoot) {
  const rootApp = isDir(join(webRoot, "app")) || isDir(join(webRoot, "pages"));
  // No application folder yet (a project being created): src/, the harness's layout since T3.
  const src = !rootApp;
  const base = src ? join(webRoot, "src") : webRoot;
  return {
    src,
    appDir: join(base, "app"),
    libDir: join(base, "lib"),
    i18nRouting: join(base, "i18n", "routing.ts"),
    /** The other place, the one Next.js does NOT serve when both could exist. */
    ignoredAppDir: src ? join(webRoot, "app") : join(webRoot, "src", "app"),
  };
}

/** The registry of subprocessors: where it already is, else in the lib folder next to the app. */
export function registryFile(webRoot) {
  const { libDir, src } = projectLayout(webRoot);
  const preferred = join(libDir, "subprocessors.json");
  const other = join(src ? webRoot : join(webRoot, "src"), "lib", "subprocessors.json");
  if (existsSync(preferred)) return preferred;
  if (existsSync(other)) return other;
  return preferred;
}

/** A project marked as a private tool (no page for the public, everything behind the admin
 *  login) carries this marker in its CLAUDE.md, written by /bootstrap when the person answered
 *  "no legal pages". Its registry is then never created by the registry script, and the audit
 *  does not ask for a policy page (hypervibe-learn, 27/09/2026: an admin-only tool had to have
 *  its legal pages removed by hand, and the next /add-* recreated the registry). */
export const PRIVATE_TOOL_MARKER = "<!-- hypervibe:no-legal-pages -->";
export function isPrivateTool(...dirs) {
  for (const d of dirs) {
    const f = join(d, "CLAUDE.md");
    try {
      if (existsSync(f) && readFileSync(f, "utf8").includes(PRIVATE_TOOL_MARKER)) return true;
    } catch {
      /* unreadable: not marked */
    }
  }
  return false;
}
