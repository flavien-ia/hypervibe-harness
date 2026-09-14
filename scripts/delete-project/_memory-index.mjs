// _memory-index.mjs - What /delete-project removes from a MEMORY.md index,
// and only that.
//
// The deletion removes the memory FILES whose name carries the project. The
// index used to be trimmed by another rule, every line that mentioned the
// project, and the two diverged both ways (outside review, 3.1.7): a line of
// another subject that cited the project in passing was removed, and a file
// kept for review lost its line. One rule now: an index line goes when its
// link points to a file that was actually deleted in this run.

/** The index lines whose link target (`[title](file.md)`) is one of `names`. */
export function indexLinesFor(lines, names) {
  const set = new Set(names.map((n) => String(n).split(/[\\/]/).pop()));
  return lines.filter((l) => {
    const m = /\]\(([^)\s]+)\)/.exec(l);
    return Boolean(m) && set.has(m[1].split(/[\\/]/).pop());
  });
}

/** A trimmed index must not keep a heading whose section became empty: the
 *  title of a project with no line left under it is noise for every later
 *  session (reported on 3.1.5). */
export function dropEmptySections(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m) {
      const level = m[1].length;
      let j = i + 1;
      let body = false;
      while (j < lines.length) {
        const n = /^(#{1,6})\s/.exec(lines[j]);
        if (n && n[1].length <= level) break;
        if (lines[j].trim()) { body = true; break; }
        j += 1;
      }
      if (!body) { i = j - 1; continue; }
    }
    out.push(lines[i]);
  }
  return out;
}

/** Trims `text` (a MEMORY.md) of the lines that pointed to `deletedNames`.
 *  Returns the new text and the removed lines, so the caller can show them. */
export function trimIndex(text, deletedNames) {
  const lines = text.split("\n");
  const removed = indexLinesFor(lines, deletedNames);
  if (removed.length === 0) return { text, removed };
  const gone = new Set(removed);
  const kept = dropEmptySections(lines.filter((l) => !gone.has(l)));
  return { text: kept.join("\n"), removed };
}
