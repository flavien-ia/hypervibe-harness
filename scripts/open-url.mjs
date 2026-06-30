#!/usr/bin/env node
// open-url.mjs - Cross-platform helper to open a URL in the user's default browser.
//
// Usage:
//   node open-url.mjs "https://example.com/some/path"
//
// Behavior:
//   - macOS  : `open <url>`
//   - Windows: `cmd /c start "" <url>`
//   - Linux  : `xdg-open <url>` (fallback `sensible-browser`, then `gio open`)
//
// Exit codes:
//   0 = launch command spawned successfully (browser opening async)
//   1 = invalid input / no launch command available

import { spawn } from "node:child_process";
import { platform } from "node:os";

const url = process.argv[2];
if (!url || !/^https?:\/\//.test(url)) {
  console.error("Usage: open-url.mjs <https-url>");
  process.exit(1);
}

const p = platform();

let cmd, args;
if (p === "darwin") {
  cmd = "open";
  args = [url];
} else if (p === "win32") {
  // cmd /c start "" <url> - the empty title is intentional so `start` doesn't parse the URL as a title
  cmd = "cmd";
  args = ["/c", "start", "", url];
} else {
  // Linux / *BSD / others
  cmd = "xdg-open";
  args = [url];
}

const child = spawn(cmd, args, {
  detached: true,
  stdio: "ignore",
  shell: false,
});

child.on("error", (err) => {
  // If xdg-open isn't installed (some minimal Linux distros), try fallbacks
  if (p !== "darwin" && p !== "win32") {
    const fallbacks = ["sensible-browser", "gio"];
    let tried = 0;
    function tryNext() {
      if (tried >= fallbacks.length) {
        console.error(`Failed to open URL: no launcher available (${err.message})`);
        process.exit(1);
      }
      const fb = fallbacks[tried++];
      const fbArgs = fb === "gio" ? ["open", url] : [url];
      const c = spawn(fb, fbArgs, { detached: true, stdio: "ignore", shell: false });
      c.on("error", tryNext);
      c.on("spawn", () => {
        c.unref();
        process.exit(0);
      });
    }
    tryNext();
  } else {
    console.error(`Failed to open URL: ${err.message}`);
    process.exit(1);
  }
});

child.on("spawn", () => {
  child.unref();
  process.exit(0);
});
