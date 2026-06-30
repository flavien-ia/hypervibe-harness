// _render.mjs - Tiny templating helper for setup-* scripts.
//
// Templates live in `templates/<feature>/...`, alongside the scripts that
// consume them. Each template is a real `.ts` / `.tsx` / `.md` file with
// Mustache-style placeholders that the script substitutes at write time.
//
// Why `{{NAME}}` and not `${NAME}`:
//   - `${...}` is native TS/JS template-literal syntax. Using it as a placeholder
//     would clash with real code (e.g. `\`${PROJECT_NAME}_user\``) inside backticks
//     and confuse syntax highlighters / TS compilers reading the templates.
//   - `{{NAME}}` is plain text - valid TS, no clash, easy to grep.
//
// Usage:
//   import { render } from "./_render.mjs";
//
//   const content = render("auth/users/pages/signin.tsx", {
//     PROJECT_NAME: "my-app",
//     DASHBOARD_URL: "/dashboard",
//   });
//   writeFileSync(dest, content);
//
// Sanity-checking:
//   After rendering, the helper verifies no `{{...}}` placeholders remain. If
//   any do, it throws - that's a sign the caller forgot to pass a variable.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "templates");

/**
 * Read a template from `templates/<relPath>` and substitute every `{{KEY}}`
 * marker with the corresponding entry in `vars`. Throws if any placeholder
 * remains unresolved after substitution.
 *
 * @param {string} relPath  - path relative to templates/ (e.g. "auth/admin/auth.ts")
 * @param {Record<string,string>} vars - substitution map
 * @returns {string} the rendered content
 */
export function render(relPath, vars = {}) {
  const tplPath = join(TEMPLATES_DIR, relPath);
  let content = readFileSync(tplPath, "utf8");

  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${escapeRe(key)}\\}\\}`, "g");
    content = content.replace(re, value);
  }

  // Sanity: all placeholders must be substituted. A leftover means the caller
  // forgot a var - fail loudly rather than silently writing broken code.
  const leftover = content.match(/\{\{[A-Z_][A-Z0-9_]*\}\}/g);
  if (leftover) {
    throw new Error(
      `render(${relPath}): unresolved placeholders ${[...new Set(leftover)].join(", ")}. ` +
        `Pass these in the vars object.`,
    );
  }

  return content;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
