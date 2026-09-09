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

const DENY = "deny";
const ASK = "ask";

/**
 * @param {string} command  the Bash command Claude is about to run
 * @returns {{decision: "deny"|"ask", reason: string} | null}
 */
export function decide(command) {
  if (!command || typeof command !== "string") return null;

  let worst = null;
  const keep = (decision, reason) => {
    if (!worst || (worst.decision === ASK && decision === DENY)) {
      worst = { decision, reason };
    }
  };

  for (const raw of segments(command)) {
    const { env, rest } = withoutEnv(raw);
    const seg = normaliseGit(withoutLauncher(rest));

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
      /^git\s+add\s+(-A\b|--all\b|-u\b|\.(\s|$))/.test(seg) ||
      /^git\s+add\s+[^|&]*\s(-A|--all|-u)(\s|$)/.test(seg) ||
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
    if (
      /^vercel\b/.test(seg) &&
      (/--prod\b/.test(seg) || /^vercel\s+(promote|rollback)\b/.test(seg))
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
    if (/^wrangler\s+(deploy|publish|versions\s+deploy|secret\s+(put|bulk))\b/.test(seg)) {
      keep(
        ASK,
        "Deploying a worker or writing one of its secrets touches code that runs with the account's keys. Confirm with the user first.",
      );
      continue;
    }

    // 4. Schema push. On this stack the local database IS production.
    //    Escape hatch, same shape as the push and sweep ones: a throwaway
    //    database nobody depends on (a demo built live on stage, a scratch
    //    project) has nothing to lose to a schema push, and the confirmation
    //    is the one interruption you cannot afford in front of an audience.
    //    Documented in the README and in the skills that need it, never in
    //    the reason below, which the model reads.
    if (/(^|\s)(pnpm|npm|yarn)\s+(run\s+)?db:push\b/.test(seg) || /drizzle-kit\s+push\b/.test(seg)) {
      if (env.get("HYPERVIBE_GUARD_ALLOW_DB_PUSH") === "1") continue;
      keep(
        ASK,
        "A schema push writes to the live database (on this stack the local one IS production). Confirm with the user, and make sure the change is additive or migrated.",
      );
      continue;
    }

    // 5. Cloud deletions. /delete-project already double-confirms; this covers
    //    the script being reached any other way.
    if (/execute-deletions\.mjs/.test(seg)) {
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
      if (destructive && !/--destructif\b/.test(seg)) {
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
      /^git\s+checkout\s+--\s+\.(\s|$)/.test(seg) ||
      /^git\s+restore\s+(--\S+\s+)*\.(\s|$)/.test(seg) ||
      /^git\s+clean\s+-[a-zA-Z]*f/.test(seg)
    ) {
      keep(
        ASK,
        "This discards uncommitted work, which may belong to another session running in the same repository. Prefer a targeted restore (`git restore <file>`), or confirm.",
      );
      continue;
    }
  }

  return worst;
}
