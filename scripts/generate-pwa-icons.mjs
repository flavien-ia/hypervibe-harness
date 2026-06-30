#!/usr/bin/env node
// generate-pwa-icons.mjs
// Rasterizes an SVG source (by default the bootstrap favicon icon.svg) into the
// PNGs expected by the PWA manifest :
//   icon-192.png (any), icon-512.png (any), icon-maskable-512.png (maskable, solid
//   background + safe zone), apple-touch-icon.png (180, solid background).
//
// Usage :
//   cd <WEB_DIR> && node generate-pwa-icons.mjs --svg <src.svg> --out <dir> --bg "#1A1410" [--maskable-scale 0.8]
//
// IMPORTANT : run with the cwd AT THE PROJECT ROOT. This script lives in the
// plugin, but `sharp` is installed in the project (pnpm add -D sharp, done by
// /add-pwa) : we resolve it from the cwd via createRequire (a bare ESM import
// would resolve relative to the plugin folder and fail).
//
// --bg expects a HEX color (#RGB or #RRGGBB). If the project palette is in
// oklch()/hsl(), convert to hex before calling the script. Invalid value →
// fallback #000000 (reported in the output).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

function arg(flag, def = null) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const svgPath = arg("--svg");
const outDir = arg("--out", "public/icons");
const bgHexArg = arg("--bg", "#000000");
const maskableScale = Number(arg("--maskable-scale", "0.8"));

if (!svgPath) {
  console.error(JSON.stringify({ error: "--svg required (path of the source SVG)." }));
  process.exit(1);
}

const requireFromProject = createRequire(path.join(process.cwd(), "package.json"));
let sharp;
try {
  sharp = requireFromProject("sharp");
} catch {
  console.error(
    JSON.stringify({
      error: "sharp not found in the current project. Run from the project root, after : pnpm add -D sharp",
    }),
  );
  process.exit(1);
}

function hexToRgb(hex) {
  const h = String(hex).replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

let bgWarning = null;
let bg = hexToRgb(bgHexArg);
if (!bg) {
  bgWarning = `--bg "${bgHexArg}" is not a valid hex, fallback #000000`;
  bg = { r: 0, g: 0, b: 0, alpha: 1 };
}

// libvips doesn't know the "system-ui" / "-apple-system" families (the text
// would fall back on a default serif, inconsistent with the browser rendering).
// We replace them with Arial, available everywhere and visually equivalent
// for a bold initial.
const svgText = readFileSync(svgPath, "utf8")
  .replace(/-apple-system/g, "Arial")
  .replace(/system-ui/g, "Arial");
const svgBuf = Buffer.from(svgText, "utf8");
mkdirSync(outDir, { recursive: true });

// Rasterizes the SVG at a given size (high density to stay sharp), transparent background.
async function renderIcon(size) {
  return sharp(svgBuf, { density: 2048 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// Icon placed on an opaque solid background (apple-touch, maskable), with scaling.
async function renderOnBackground(size, scale) {
  const iconSize = Math.round(size * scale);
  const icon = await renderIcon(iconSize);
  const offset = Math.round((size - iconSize) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: icon, top: offset, left: offset }])
    .png()
    .toBuffer();
}

const results = [];
async function emit(name, buf) {
  writeFileSync(path.join(outDir, name), buf);
  results.push(name);
}

// "any" : transparent, full frame (the bootstrap SVG has its own rounded background)
await emit("icon-192.png", await renderIcon(192));
await emit("icon-512.png", await renderIcon(512));
// maskable : solid background + safe zone (the OS may crop the edges into a circle)
await emit("icon-maskable-512.png", await renderOnBackground(512, maskableScale));
// apple-touch : solid background (iOS doesn't like transparency), 180px
await emit("apple-touch-icon.png", await renderOnBackground(180, 1));

process.stdout.write(JSON.stringify({ ok: true, outDir, files: results, warning: bgWarning }));
