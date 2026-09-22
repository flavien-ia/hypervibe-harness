// sql-guard.mjs - The guards every SQL statement goes through.
//
// Destructive SQL is refused unless it was asked for by name. This file is that rule, in ONE
// place: the command that runs SQL (scripts/neon/run-sql.mjs) and the Bash guardrail
// (hooks/rules.mjs, rule 6) both read it here. The two used to keep their own expressions and
// disagreed on a statement that only cites a keyword inside a string literal (outside
// review, 3.2.5). Nothing in it knows a provider: it reads SQL, it sends nothing.
//
//   splitStatements(sql)           the statements of a script, split on top-level semicolons
//   statementsDestructrices(sql)   what a run would destroy: [] when nothing

// ─── Split on top-level semicolons ─────────────────────────────────────
// Skips: '...' strings (with '' doubling), E'...' backslash escapes, "..."
// identifiers, $$ / $tag$ dollar-quoted bodies (function definitions), -- line
// comments and /* nestable */ block comments.
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? n : nl + 1;
      buf += sql.slice(i, end);
      i = end;
      continue;
    }
    // Block comment (nestable in Postgres)
    if (c === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Single-quoted string; E'' enables backslash escapes
    if (c === "'") {
      const escaped = /[eE]$/.test(buf);
      let j = i + 1;
      while (j < n) {
        if (escaped && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; } // '' literal quote
          j++;
          break;
        }
        j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Double-quoted identifier
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      buf += sql.slice(i, j);
      i = j;
      continue;
    }
    // Dollar-quoted string: $$ ... $$ or $tag$ ... $tag$
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        buf += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    // Statement separator
    if (c === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Les instructions qu'on refuse d'executer sans intention explicite.
 *
 * L'analyse se fait par instruction (via splitStatements, qui connait deja les
 * chaines, les commentaires et les corps dollar-quotes) : un `DELETE FROM t
 * WHERE ...` legitime au milieu d'un lot ne doit pas etre confondu avec le
 * `DELETE FROM t` nu qui le suit. Les mots-cles sont cherches hors chaines,
 * pour qu'un `INSERT INTO log VALUES ('DROP TABLE')` passe sans encombre.
 */
// Tout DROP, quel que soit l'objet. Une liste d'objets (TABLE, SCHEMA, INDEX...) en
// oublie toujours un : DROP FUNCTION, DROP POLICY, DROP MATERIALIZED VIEW passaient.
// Le garde-fou (hooks/rules.mjs) porte la MEME expression : ne pas changer l'une sans l'autre.
const DROP_ANYTHING = /\bDROP\s+[A-Za-z_]/i;
// Un WHERE qui ne borne rien (WHERE true, WHERE 1=1) vaut une absence de WHERE.
const WHERE_TOUJOURS_VRAI = /\bWHERE\s+(?:TRUE|1\s*=\s*1|''\s*=\s*'')\s*(?:RETURNING\b[\s\S]*)?$/i;

function sansCommentaires(stmt) {
  return stmt.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

function motifDestructeur(texte) {
  if (DROP_ANYTHING.test(texte)) return /\bALTER\b/i.test(texte) && !/^\s*DROP\b/i.test(texte) ? "ALTER ... DROP" : "DROP";
  if (/\bTRUNCATE\b/i.test(texte)) return "TRUNCATE";
  const borne = /\bWHERE\b/i.test(texte) && !WHERE_TOUJOURS_VRAI.test(texte.trim());
  if (/\bDELETE\s+FROM\b/i.test(texte) && !borne) return "DELETE sans WHERE";
  // An upsert (`ON CONFLICT ... DO UPDATE SET`) rewrites the conflicting row only, and a MERGE
  // (`WHEN MATCHED THEN UPDATE SET`) the matched rows only: neither is an UPDATE of every row.
  const misesAJour = texte.replace(/\b(?:DO|THEN)\s+UPDATE\s+SET\b/gi, " ");
  if (/\bUPDATE\b[\s\S]*\bSET\b/i.test(misesAJour) && !borne) return "UPDATE sans WHERE";
  return null;
}

export function statementsDestructrices(sql) {
  const trouve = [];
  for (const stmt of splitStatements(sql)) {
    // Neutralise chaines et commentaires avant de chercher les mots-cles.
    const nu = sansCommentaires(
      stmt.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"])*"/g, '""'),
    );
    const motif = motifDestructeur(nu);
    if (motif) {
      trouve.push(motif);
      continue;
    }
    // Un bloc DO s'execute tout de suite, et son SQL dynamique vit dans des chaines :
    // `DO $$ BEGIN EXECUTE 'DROP TABLE clients'; END $$` etait invisible une fois les
    // chaines neutralisees. On relit donc le bloc AVEC ses chaines. Et quand le SQL est
    // fabrique a l'execution (concatenation, format), le controle ne peut pas le voir :
    // il refuse, il ne laisse pas passer.
    if (/^\s*DO\b/i.test(nu)) {
      const brut = sansCommentaires(stmt);
      const dansLeBloc = motifDestructeur(brut);
      if (dansLeBloc) trouve.push(`${dansLeBloc} (dans un bloc DO)`);
      else if (/\bEXECUTE\b/i.test(nu)) trouve.push("SQL dynamique (EXECUTE dans un bloc DO)");
    }
  }
  return [...new Set(trouve)];
}
