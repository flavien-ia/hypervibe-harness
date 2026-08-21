// managed-block.mjs - Generic engine for a plugin-managed block of rules
// inside a markdown file the user also owns (their global CLAUDE.md, their
// project CLAUDE.md).
//
// The problem this solves: the previous implementation was additive only. It
// could add a rule, never update one and never remove one, and it only ran at
// /start. A rule shipped with a mistake stayed wrong on every machine forever
// (that happened: the dependency-audit command was broken for months), and the
// block could only grow.
//
// The contract here is the one package managers use for config files they own:
//
//   - We ship each rule with a fingerprint of the exact text we delivered
//     (`<!-- rule:<id> sha:<12 hex> -->`). "Untouched" is therefore verifiable
//     without keeping any history: hash what is installed, compare.
//   - Untouched  -> we may update it, or remove it.
//   - Edited     -> it is the user's line now. We keep it, byte for byte, and
//                   say so in the report.
//   - Unknown id -> kept untouched too (a personal rule, or a newer plugin).
//
// Nothing outside the OPEN/CLOSE markers is ever read or rewritten.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/** First 12 hex of the SHA-256 of a rule text. Collisions are irrelevant here:
 *  this detects human edits, not adversarial ones. */
export function shortSha(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
}

const MARKER = /^<!-- rule:([\w-]+)(?: sha:([0-9a-f]{6,64}))? -->$/;

/** Splits the inside of a block into its entries. Everything before the first
 *  marker is preamble (heading + intro), regenerated on every write. */
function parseEntries(inner) {
  const lines = inner.split("\n");
  const entries = [];
  let current = null;
  let sawMarker = false;

  for (const line of lines) {
    const m = MARKER.exec(line.trim());
    if (m) {
      sawMarker = true;
      if (current) entries.push(current);
      current = { id: m[1], sha: m[2] ?? null, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) entries.push(current);

  for (const e of entries) {
    // Drop the blank lines that separate entries, keep the rule text itself.
    while (e.lines.length && e.lines[e.lines.length - 1].trim() === "") e.lines.pop();
    while (e.lines.length && e.lines[0].trim() === "") e.lines.shift();
    const raw = e.lines.join("\n");
    e.raw = raw;
    e.text = raw.replace(/^- /, "");
  }
  return { entries, sawMarker };
}

/** A rule we shipped is "managed" when the installed text is still the text we
 *  delivered: by fingerprint when the marker carries one, by comparison with
 *  the known texts otherwise (installs that predate fingerprints). */
function isManaged(entry, rule) {
  if (entry.sha) return entry.sha === shortSha(entry.text);
  if (!rule) return false;
  if (entry.text === rule.text) return true;
  return (rule.previousTexts ?? []).includes(entry.text);
}

function renderEntry(id, text) {
  return `<!-- rule:${id} sha:${shortSha(text)} -->\n- ${text}`;
}

/**
 * Synchronise one managed block.
 *
 * @param {object} o
 * @param {string} o.file      absolute path of the markdown file
 * @param {string} o.open      opening marker, e.g. "<!-- hypervibe:rules -->"
 * @param {string} o.close     closing marker
 * @param {string} o.heading   markdown heading rendered at the top of the block
 * @param {string} o.intro     one line telling the user how the block behaves
 * @param {Array}  o.active    rules that must be present  [{id, text, previousTexts?}]
 * @param {Array}  o.retire    rules to remove when untouched (retired, wrong scope, superseded)
 * @param {Array}  o.optional  rules never added nor removed, updated if present
 *                             (capability rules whose flag is off right now)
 * @param {string} [o.anchor]  when the file exists without a block, insert right
 *                             after this exact line instead of at the end
 * @param {boolean} [o.dryRun] compute everything, write nothing
 * @returns {{result: string, added: string[], updated: string[], retired: string[],
 *            keptEdited: string[], unknown: string[], bytes: number}}
 */
export function syncManagedBlock(o) {
  const report = {
    result: "no-change",
    added: [],
    updated: [],
    retired: [],
    keptEdited: [],
    unknown: [],
    bytes: 0,
  };

  const before = existsSync(o.file) ? readFileSync(o.file, "utf8") : "";
  // The file belongs to the user: whatever line ending they use, we use.
  const crlf = /\r\n/.test(before);
  const normalised = crlf ? before.replace(/\r\n/g, "\n") : before;

  const blockRe = new RegExp(
    `${escapeRe(o.open)}[\\s\\S]*?${escapeRe(o.close)}`,
  );
  const match = normalised.match(blockRe);

  const byId = new Map();
  for (const r of [...o.active, ...o.retire, ...o.optional]) byId.set(r.id, r);

  /** @type {{entries: Array, sawMarker: boolean}} */
  let parsed = { entries: [], sawMarker: false };
  if (match) {
    const inner = match[0].slice(o.open.length, match[0].length - o.close.length);
    parsed = parseEntries(inner);
  }

  // A block with no per-rule marker at all predates this mechanism entirely
  // (no ids, no fingerprints): there is nothing to recognise, so it is replaced
  // wholesale, exactly as the previous implementation did.
  const legacy = !!match && !parsed.sawMarker;
  const installed = new Map();
  if (!legacy) for (const e of parsed.entries) installed.set(e.id, e);

  const rendered = [];
  const handled = new Set();

  for (const rule of o.active) {
    handled.add(rule.id);
    const entry = installed.get(rule.id);
    if (!entry) {
      rendered.push(renderEntry(rule.id, rule.text));
      report.added.push(rule.id);
      continue;
    }
    if (!isManaged(entry, rule)) {
      rendered.push(entry.raw ? `<!-- rule:${rule.id} -->\n${entry.raw}` : "");
      report.keptEdited.push(rule.id);
      continue;
    }
    rendered.push(renderEntry(rule.id, rule.text));
    if (entry.text !== rule.text) report.updated.push(rule.id);
  }

  for (const rule of o.optional) {
    handled.add(rule.id);
    const entry = installed.get(rule.id);
    if (!entry) continue; // never added on our own initiative
    if (!isManaged(entry, rule)) {
      rendered.push(`<!-- rule:${rule.id} -->\n${entry.raw}`);
      report.keptEdited.push(rule.id);
      continue;
    }
    rendered.push(renderEntry(rule.id, rule.text));
    if (entry.text !== rule.text) report.updated.push(rule.id);
  }

  for (const rule of o.retire) {
    handled.add(rule.id);
    const entry = installed.get(rule.id);
    if (!entry) continue;
    if (!isManaged(entry, rule)) {
      // The user reworded a rule we want gone: it is theirs, it stays.
      rendered.push(`<!-- rule:${rule.id} -->\n${entry.raw}`);
      report.keptEdited.push(rule.id);
      continue;
    }
    report.retired.push(rule.id);
  }

  // Ids we know nothing about: a personal rule the user wrote inside the block,
  // or a rule from a plugin version newer than this script. Left alone.
  for (const entry of parsed.entries) {
    if (handled.has(entry.id)) continue;
    const marker = entry.sha
      ? `<!-- rule:${entry.id} sha:${entry.sha} -->`
      : `<!-- rule:${entry.id} -->`;
    rendered.push(`${marker}\n${entry.raw}`);
    report.unknown.push(entry.id);
  }

  const body = rendered.filter(Boolean).join("\n");
  const block = `${o.open}\n${o.heading}\n\n${o.intro}\n\n${body}\n${o.close}`;
  report.bytes = Buffer.byteLength(block, "utf8");

  let after;
  if (match) {
    after = normalised.replace(blockRe, () => block);
    report.result = legacy ? "upgraded" : "changed";
  } else if (!normalised) {
    after = `${block}\n`;
    report.result = "created";
  } else if (o.anchor && normalised.includes(`\n${o.anchor}\n`)) {
    // Insert right under the anchor line (a section heading), so the block
    // lands where it belongs rather than at the end of the file.
    after = normalised.replace(`\n${o.anchor}\n`, `\n${o.anchor}\n\n${block}\n`);
    report.result = "created";
  } else {
    const sep = normalised.endsWith("\n") ? "\n" : "\n\n";
    after = normalised + sep + block + "\n";
    report.result = "created";
  }

  if (after === normalised) report.result = "no-change";

  const out = crlf ? after.replace(/\n/g, "\r\n") : after;
  if (!o.dryRun && out !== before) {
    mkdirSync(dirname(o.file), { recursive: true });
    writeFileSync(o.file, out, "utf8");
  }
  return report;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
