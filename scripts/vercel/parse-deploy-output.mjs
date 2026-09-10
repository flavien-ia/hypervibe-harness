// parse-deploy-output.mjs - Read the production alias URL and the deployment
// URL out of `vercel --prod` output.
//
// Two traps, seen on a real /bootstrap on 2026-09-10 with Vercel CLI 59:
//   - labels are aligned in columns with no colon
//     ("▲ Aliased         https://x.vercel.app"), where older CLIs printed
//     "Aliased: https://x.vercel.app";
//   - the production line comes right after the spinner's ANSI sequences
//     (ESC[2K ESC[1A ESC[2K ESC[G), even when the output is captured rather
//     than shown in a terminal.
// So every ANSI sequence is stripped first, then both label forms are accepted.

// CSI (colors, erase, cursor moves) and OSC (terminal hyperlinks).
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/** Remove ANSI escape sequences from terminal output. */
export function stripAnsi(text) {
  return String(text ?? "").replace(ANSI, "");
}

// A whole *.vercel.app URL: nothing may follow ".vercel.app" that would
// extend the host name (".vercel.app.example.com" is rejected).
const VERCEL_URL = String.raw`(https:\/\/[^\s]+?\.vercel\.app)(?![\w.-])`;

function afterLabel(text, label) {
  return new RegExp(String.raw`\b${label}:?\s+` + VERCEL_URL).exec(text)?.[1] ?? null;
}

/**
 * @param {string} output stdout + stderr of `vercel --prod`
 * @returns {{ aliasUrl: string | null, productionUrl: string | null }}
 */
export function parseDeployOutput(output) {
  const clean = stripAnsi(output);
  return {
    aliasUrl: afterLabel(clean, "Aliased"),
    productionUrl: afterLabel(clean, "Production"),
  };
}
