// hooks/rules.mjs - The decision function behind the Bash guardrail.
//
// Why a hook and not a rule in CLAUDE.md: a written rule is a probabilistic
// influence competing with everything else in the context. It was measured, on
// a user's own transcripts, to change nothing at all: a week after the rule was
// added, the forbidden pattern still accounted for 17 of 40 failing calls. The
// hook changed the behaviour immediately, for a mechanical reason: the call
// cannot happen, and the model gets told what to do instead.
//
// Two decisions, and the difference matters:
//   deny -> there is no legitimate use here, and there is a correct alternative
//           we can name. The model reads the reason and takes the other path.
//   ask  -> the action is legitimate, but it is irreversible or outward-facing,
//           so a human confirms. Consent lives in the conversation, which a
//           hook cannot read: blocking outright would also block the push that
//           follows the user's "yes". In a non-interactive session `ask` fails
//           closed, which is the safe direction.
//
// Deliberately short. Every extra pattern brings the guardrail closer to the
// one that blocks everything, and a guardrail that cries wolf gets bypassed.
// Style and architecture stay in CLAUDE.md, where they belong.

/** Splits a command line into the segments a shell would run in sequence,
 *  respecting quotes: `echo "git add -A"` is one segment whose payload is a
 *  string, not a staging command. */
export function segments(command) {
  const out = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      current += c;
      if (c === quote && command[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      current += c;
      continue;
    }
    if (c === "\n" || c === ";") {
      out.push(current);
      current = "";
      continue;
    }
    if ((c === "&" || c === "|") && command[i + 1] === c) {
      out.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (c === "|") {
      out.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Drops leading environment assignments (`FOO=1 git push`) so the command
 *  itself can be matched, and reports the ones we care about. */
function withoutEnv(segment) {
  const env = new Map();
  let rest = segment;
  for (;;) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s+/.exec(rest);
    if (!m) break;
    env.set(m[1], m[2]);
    rest = rest.slice(m[0].length);
  }
  return { env, rest };
}

/** The quoted payload of a command, unquoted. Used to look at the SQL a
 *  run-sql.mjs call is about to run, not at the command that carries it. */
function quotedPayloads(segment) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;
  let m;
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? "");
  return out;
}

/** `git -C <dir> add -A` is still `git add -A`. Git accepts global options
 *  before the subcommand (-C <dir>, -c key=val, --git-dir=..., --no-pager):
 *  strip them so the subcommand sits right after `git`, whatever precedes it.
 *  Without this, `git -C "$DIR" push` slipped past every pattern: found on the
 *  plugin's own release skill, which pushes exactly that way. */
function normaliseGit(seg) {
  const m = /^git\s+/.exec(seg);
  if (!m) return seg;
  let rest = seg.slice(m[0].length);
  const option =
    /^(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)|-c\s+(?:"[^"]*"|'[^']*'|\S+)|--(?:git-dir|work-tree|namespace|exec-path)=\S+|--no-pager|--no-replace-objects|--literal-pathspecs|--bare)\s+/;
  let o;
  while ((o = option.exec(rest)) !== null) rest = rest.slice(o[0].length);
  return `git ${rest}`;
}

/** `npx vercel --prod` is still `vercel --prod`. A one-shot runner (npx, bunx,
 *  pnpm dlx, yarn dlx, pnpm exec) only prefixes the real command: strip it,
 *  and its own flags, so the rules below see the tool they name. Found by an
 *  outside reader on 2.9.5: `pnpm dlx vercel --prod` walked past rule 3, and
 *  it is the very form the plugin recommends elsewhere. */
function withoutLauncher(seg) {
  const m =
    /^(?:npx|bunx|(?:pnpm|yarn)\s+(?:dlx|exec))\s+(?:(?:-y|-q|--yes|--quiet|--silent|-p\s+\S+|--package[= ]\S+)\s+)*/.exec(
      seg,
    );
  return m ? seg.slice(m[0].length) : seg;
}

/** `wrangler@latest deploy` is `wrangler deploy`: a version pin on the head
 *  token is dropped, a scoped package (`@scope/pkg`) keeps its `@`. Found by
 *  an outside reader on 3.0.4: `withoutLauncher` alone left it unmatched. */
function withoutVersion(seg) {
  return seg.replace(/^([^@\s]+)@[^\s/]+(?=\s|$)/, "$1");
}

/** Where a command hides. `sudo git add -A`, `/usr/bin/git add -A`,
 *  `command git add -A`, `(git add -A && ...)`, `{ git add -A; }`,
 *  `if x; then git add -A; fi`: one family, and the family is infinite, so
 *  a pattern per shape never closes it (outside review, 3.0.4). The rules
 *  therefore never see the raw head of a segment: the openers a shell
 *  swallows are peeled off, the prefixes that run the rest unchanged are
 *  dropped with their own options, a quoted or backslashed head is
 *  unquoted, a launcher and a version pin go, and a path is reduced to its
 *  binary. Repeated until nothing changes, because the shapes stack
 *  (`sudo env FOO=1 /usr/bin/git ...`). The assignments met on the way are
 *  collected: the escape prefixes are read from them. */
function normalise(raw) {
  const env = new Map();
  let s = raw.trim();
  for (let round = 0; round < 16; round += 1) {
    const before = s;
    // Openers and keywords a shell swallows before the command itself, and
    // the closers of the same blocks at the end.
    s = s.replace(/^(?:[({]\s*|(?:then|do|else|elif|if|while|until)\s+|!\s+)/, "");
    s = s.replace(/[\s;]*[)}]+$/, "");
    // A whole segment in quotes (`eval "git push"`) is the command it quotes.
    s = s.replace(/^(["'])(.*)\1$/, "$2");
    // `FOO=1 git push`: assignments carry the escape prefixes, keep them.
    const e = withoutEnv(s);
    for (const [k, v] of e.env) env.set(k, v);
    s = e.rest;
    // Prefixes that run the rest unchanged, with their own options.
    s = s.replace(/^(?:sudo|doas)(?:\s+(?:-[ug]\s+\S+|-[A-Za-z]+|--\S*))*\s+/, "");
    s = s.replace(/^env(?:\s+-i)?(?:\s+-u\s+\S+)*\s+/, "");
    s = s.replace(/^nice(?:\s+-n\s+\S+|\s+-\d+)?\s+/, "");
    s = s.replace(/^time(?:\s+-p)?\s+/, "");
    s = s.replace(/^(?:command(?:\s+-p)?|builtin|exec|nohup|eval)\s+/, "");
    // A quoted or escaped head: `"git" push`, `\git push`.
    s = s.replace(/^(["'])([^"'\s]+)\1(?=\s|$)/, "$2").replace(/^\\(?=\S)/, "");
    // A launcher, a version pin, a path: `npx wrangler@latest deploy`,
    // `/usr/bin/git push`, `./node_modules/.bin/vercel --prod`.
    s = withoutVersion(withoutLauncher(s));
    s = s.replace(/^(?:[A-Za-z]:)?[^\s"'=]*\/(?=[^\s/]+(?:\s|$))/, "");
    s = normaliseGit(s);
    if (s === before) break;
  }
  return { env, seg: s.trim() };
}

/** Command substitutions run their content: `x=$(git push origin main)` is a
 *  push, `` v=`git add -A` `` a sweep. Pulls every `$(...)` (nested ones
 *  included, they recurse through decide) and every backtick span out of a
 *  segment, skipping single-quoted text where a shell would not expand them.
 *  Returns the segment without them, and their contents, each a command line
 *  of its own. Found by an outside reader on 3.1.8: an assignment swallowed
 *  `$(node`, and the rule for the shared clock never saw the launcher. A
 *  backslash escapes the next character, so a quoted `\$(...)` or a
 *  backslashed backtick (a commit message that TALKS about a command)
 *  stays text: the guardrail refused its own release commit on 3.1.9 before
 *  this line existed. */
function withoutSubstitutions(segment) {
  const inner = [];
  let text = "";
  let i = 0;
  while (i < segment.length) {
    const c = segment[i];
    // An escaped dollar or backtick is literal for the shell (`\$(x)` in a
    // commit message runs nothing): copy both characters and move on.
    if (c === "\\") {
      text += segment.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = segment.indexOf("'", i + 1);
      const stop = end < 0 ? segment.length : end + 1;
      text += segment.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === "$" && segment[i + 1] === "(") {
      let depth = 0;
      let j = i + 1;
      for (; j < segment.length; j += 1) {
        if (segment[j] === "(") depth += 1;
        else if (segment[j] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      inner.push(segment.slice(i + 2, j));
      i = j + 1;
      continue;
    }
    if (c === "`") {
      const end = segment.indexOf("`", i + 1);
      const stop = end < 0 ? segment.length : end;
      inner.push(segment.slice(i + 1, stop));
      i = stop + 1;
      continue;
    }
    text += c;
    i += 1;
  }
  return { text, inner: inner.map((x) => x.trim()).filter(Boolean) };
}

const DENY = "deny";
const ASK = "ask";

/**
 * @param {string} command  the Bash command Claude is about to run
 * @returns {{decision: "deny"|"ask", reason: string} | null}
 */
export function decide(command, inherited = new Map()) {
  if (!command || typeof command !== "string") return null;

  let worst = null;
  const keep = (decision, reason) => {
    if (!worst || (worst.decision === ASK && decision === DENY)) {
      worst = { decision, reason };
    }
  };

  for (const raw of segments(command)) {
    // What a substitution runs is judged first, as a command line of its own;
    // the segment is then read without it (`x=$(git push)` leaves `x=`).
    const { text: outer, inner } = withoutSubstitutions(raw);
    const { env, seg } = normalise(outer);
    for (const [k, v] of inherited) if (!env.has(k)) env.set(k, v);
    for (const payload of inner) {
      const verdict = decide(payload, env);
      if (verdict) keep(verdict.decision, verdict.reason);
    }
    if (!seg) continue;

    // A shell handed a command string runs it: `sh -c "git push"` is a push,
    // `bash -lc "git add -A && git push"` is both. The payload is a command
    // line of its own and goes through the same decision, with the
    // assignments met on the way (an escape prefix is typed outside the
    // quotes, where the caller can see it).
    if (
      /^(?:sh|bash|zsh|dash|ksh|fish)\s/.test(seg) &&
      /^\S+(?:\s+-[A-Za-z-]+)*\s+-[A-Za-z]*c[A-Za-z]*\s/.test(seg)
    ) {
      for (const payload of quotedPayloads(seg)) {
        const inner = decide(payload, env);
        if (inner) keep(inner.decision, inner.reason);
      }
      continue;
    }

    // 1. Sweeping stage. No legitimate use in a repository where another
    //    session may be working, and the alternative is one word longer.
    //    One documented exception: an operation that restructures the whole
    //    tree (monorepo conversion) after a `git status` proved nothing
    //    foreign is pending. The prefix makes that intent explicit and
    //    visible in the command itself.
    //    The prefix is documented in the README and in the skills that need
    //    it, and deliberately NOT in the reason below: that text is read by
    //    the model, which is also who can type the prefix. A refusal that
    //    names its own bypass is bypassed by its reader (outside review,
    //    2.9.5). Same for the push rule.
    if (
      /^git\s+add\s+(-[a-zA-Z]*[Au][a-zA-Z]*\b|--all\b|--update\b|\.(\s|$))/.test(seg) ||
      /^git\s+add\s+[^|&]*\s(-[a-zA-Z]*[Au][a-zA-Z]*|--all|--update|\.)(\s|$)/.test(seg) ||
      /^git\s+commit\s+(-[a-zA-Z]*a[a-zA-Z]*|--all)(\s|$)/.test(seg)
    ) {
      if (env.get("HYPERVIBE_GUARD_ALLOW_SWEEP") === "1") continue;
      keep(
        DENY,
        "Sweeping stage refused: on 2026-08-17 it swept another session's uncommitted work into a commit. Stage nominatively instead: `git add <file> [<file>...]`, then `git commit -m ...`. Check `git status --short` first if you are unsure what is pending.",
      );
      continue;
    }

    // 2a. Pushing past the pre-push hook. Since /add-test, that hook is the
    //     project's recette (tests + every feature verified): skipping it is
    //     exactly what the guard exists to prevent, and the alternative is
    //     always the same, complete the recette. No env escape here: the
    //     push rule below already has one for the cases where a push is
    //     legitimately automated, and none of them needs to skip the hook.
    if (/^git\s+(-\S+\s+)*push\b/.test(seg) && /--no-verify\b/.test(seg)) {
      keep(
        DENY,
        "Pushing with --no-verify skips the project's pre-push recette (tests and cahier de recette). Run `pnpm test` and `node scripts/check-recette.mjs`, complete what they report, then push normally.",
      );
      continue;
    }

    // 2. Pushing publishes. The user's consent lives in the conversation.
    if (/^git\s+(-\S+\s+)*push\b/.test(seg) && !/--dry-run\b/.test(seg)) {
      if (env.get("HYPERVIBE_GUARD_ALLOW_PUSH") === "1") continue;
      keep(
        ASK,
        "A push publishes. Confirm with the user first (a standing agreement stated in chat counts).",
      );
      continue;
    }

    // 3. Deploying straight to production, bypassing the git history.
    //    `--target production` is Vercel's own long form of `--prod`, and
    //    `vercel build --prod` builds locally and deploys nothing: not a
    //    deploy, so not a question (outside review, 3.0.4).
    if (
      /^vercel\b/.test(seg) &&
      !/^vercel\s+build\b/.test(seg) &&
      (/--prod\b/.test(seg) ||
        /--target[= ]production\b/.test(seg) ||
        /^vercel\s+(promote|rollback)\b/.test(seg))
    ) {
      keep(
        ASK,
        "Production deploys normally go through `git push` on the main branch. A direct deploy needs the user's explicit confirmation.",
      );
      continue;
    }

    // 3b. Deploying a Cloudflare worker, or writing one of its secrets. The
    //     shared clock holds account-level keys for every project (Neon,
    //     Cloudflare, email): a deploy publishes code that runs with them, a
    //     `secret put` rewrites one. The plugin's own scripts drive wrangler
    //     from Node (ensure.mjs, register.mjs), which the hook does not see and
    //     which sit behind their skills' confirmations; this covers the model
    //     reaching for wrangler directly (outside review, 2.9.5).
    //     A `--dry-run` deploys nothing, like `git push --dry-run` above.
    if (
      /^wrangler\s+(deploy|publish|versions\s+deploy|secret\s+(put|bulk))\b/.test(seg) &&
      !/--dry-run\b/.test(seg)
    ) {
      keep(
        ASK,
        "Deploying a worker or writing one of its secrets touches code that runs with the account's keys. Confirm with the user first.",
      );
      continue;
    }

    // 4. Schema push. On this stack the local database IS production.
    //    Escape hatch, but NOT the same shape as the push and sweep ones: the
    //    hook cannot tell a throwaway database (a demo built live on stage)
    //    from production, and a prefix typed by the model in the command would
    //    let the model decide that. So this exception is read from the
    //    environment Claude Code was launched in, set by a human before the
    //    session, never from the command line (outside review, 3.1.4).
    //    Documented in the README, never in the reason below, which the model
    //    reads.
    //    The monorepo form (`pnpm --filter web db:push`, `pnpm -r db:push`) is
    //    the one _convert-to-turborepo generates: same push, same question.
    if (
      /(^|\s)(pnpm|npm|yarn)\s+(?:(?:--filter(?:=\S+|\s+\S+)|-F\s+\S+|-r|--recursive|-w|--workspace(?:=\S+|\s+\S+)?|--prefix(?:=\S+|\s+\S+)|-C\s+\S+|--dir\s+\S+)\s+)*(?:run\s+)?db:push\b/.test(seg) ||
      /drizzle-kit\s+push\b/.test(seg)
    ) {
      if (process.env.HYPERVIBE_GUARD_ALLOW_DB_PUSH === "1") continue;
      keep(
        ASK,
        "A schema push writes to the live database (on this stack the local one IS production). First run the plugin's scripts/neon/schema-drift.mjs from the folder holding drizzle.config (read-only): exit 3 lists the tables and columns the push would drop or truncate. Then confirm with the user, and make sure the change is additive or migrated.",
      );
      continue;
    }

    // 5. Cloud deletions. /delete-project already double-confirms; this covers
    //    the script being reached any other way. Only when a runtime LAUNCHES
    //    it: `cat` or `grep` on the file is a read, and asking there is the
    //    same wolf rule 6 stopped crying on 3.0.1 (outside review, 3.0.4).
    if (/^(?:node|bun|deno|tsx)\s/.test(seg) && /execute-deletions\.mjs/.test(seg)) {
      keep(
        ASK,
        "Irreversible cloud deletions (Vercel, Neon, R2, DNS). This runs only inside /delete-project, after its explicit double confirmation.",
      );
      continue;
    }

    // 6. Destructive SQL. The hook only sees the command line, so run-sql.mjs
    //    carries the same check for SQL passed by file or heredoc.
    //    Only when a runtime LAUNCHES the script: `grep "DROP" run-sql.mjs` is
    //    a read, and it used to be refused because the segment carried the
    //    file name and a quoted keyword (outside review, 2.9.5). Exactly the
    //    wolf the note at the top of this file says to avoid.
    if (/^(?:node|bun|deno|tsx)\s/.test(seg) && /run-sql\.mjs/.test(seg)) {
      const sql = quotedPayloads(seg).join(" ");
      const destructive = /\b(DROP\s+(TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE)\b/i.test(sql) ||
        /\bALTER\s+TABLE\b[\s\S]*\bDROP\b/i.test(sql);
      const unbounded =
        (/\bDELETE\s+FROM\b/i.test(sql) || /\bUPDATE\b[\s\S]*\bSET\b/i.test(sql)) &&
        !/\bWHERE\b/i.test(sql);
      // run-sql.mjs accepts both spellings of the flag; so does this rule,
      // or the alias its own usage documents is refused with a message that
      // tells the user to do what they just did (outside review, 3.0.4).
      if (destructive && !/--destructi(?:f|ve)\b/.test(seg)) {
        keep(
          DENY,
          "Destructive SQL refused (DROP / TRUNCATE). If it is genuinely intended, re-run the same command with the `--destructif` flag, which will ask the user to confirm.",
        );
        continue;
      }
      if (destructive || unbounded) {
        keep(
          ASK,
          "This statement rewrites or removes rows without a WHERE clause, or drops an object. Confirm with the user, and consider adding a WHERE clause.",
        );
        continue;
      }
    }

    // 7. Discarding uncommitted work, possibly someone else's.
    if (
      /^git\s+reset\s+(--hard|--merge)\b/.test(seg) ||
      /^git\s+checkout\s+(?:--\s+)?\.(\s|$)/.test(seg) ||
      /^git\s+restore\s+(--\S+\s+)*\.(\s|$)/.test(seg) ||
      /^git\s+clean\s+(?:-\S+\s+)*(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b/.test(seg)
    ) {
      keep(
        ASK,
        "This discards uncommitted work, which may belong to another session running in the same repository. Prefer a targeted restore (`git restore <file>`), or confirm.",
      );
      continue;
    }

    // 8. Trusting a checkout's versioned git hooks. `git config
    //    hypervibe.hooks true` lets the .hooks/* of THIS clone run on this
    //    machine: code that arrived with a clone. A person decides that, per
    //    checkout. The hook's own notice reaches the model in the output of a
    //    commit, so the model must not be the one typing the opt-in (outside
    //    review, 3.1.6). Reads and the removal of the opt-in stay free.
    //    Git reads key names case-insensitively (`HYPERVIBE.HOOKS` sets the
    //    same value), so does the match; and a read is a read only when its
    //    option or subcommand comes BEFORE the key, not in a trailing comment
    //    (outside review, 3.1.8).
    const trustKey = /^git\s+config\b/.test(seg) ? /\bhypervibe\.hooks\b/i.exec(seg) : null;
    const trustWrite =
      trustKey !== null &&
      !/\s(?:--get(?:-all|-regexp)?|--unset(?:-all)?|--list|get|unset|list)(?=\s|$)/.test(seg.slice(0, trustKey.index));
    if (
      trustWrite ||
      (/^(?:node|bun|deno|tsx)\s/.test(seg) && /ensure-hooks-chain\.mjs/.test(seg) && /--trust\b/.test(seg))
    ) {
      keep(
        ASK,
        "Trusting this checkout's versioned git hooks means running code that arrived with a clone. A person decides that, per checkout: confirm with the user first.",
      );
      continue;
    }

    // 9. Redeploying the shared clock through one of the plugin's own
    //    scripts. ensure.mjs and worker-check.mjs end in `wrangler deploy`
    //    (rule 3b) when the worker is behind: same code, same keys, same
    //    question. Their --dry-run says whether a deploy would happen and
    //    changes nothing, so it stays free (outside review, 3.1.6).
    //    Matched on the script's name after the launcher, whatever the path:
    //    `cd scripts/shared-worker && node ensure.mjs` is the same run
    //    (outside review, 3.1.8).
    const launched = /^(?:node|bun|deno|tsx)\s+(?:-\S+\s+)*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(seg);
    const launchedBase = launched ? (launched[1] ?? launched[2] ?? launched[3]).split(/[\\/]/).pop() : "";
    if (
      /^(?:ensure|worker-check)\.mjs$/.test(launchedBase) &&
      !/--dry-run\b/.test(seg) &&
      !/--no-deploy\b/.test(seg)
    ) {
      keep(
        ASK,
        "This can redeploy the shared clock, code that runs with the account's keys. Run it with --dry-run first to see whether a deploy is needed, and confirm with the user before the real run.",
      );
      continue;
    }
  }

  return worst;
}
