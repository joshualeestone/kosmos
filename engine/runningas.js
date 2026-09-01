'use strict';

/**
 * What account and model an agent is ACTUALLY running on, read live.
 *
 * 🛑 WHY THIS EXISTS (#1304). Josh asked three agents which account they were on.
 * Two could not say, one could, and one said it could not after another had.
 * Measured on this fleet the same morning:
 *
 *     briefs naming a model :  5      panes running that model :  0
 *     briefs naming account :  5      wrong                    :  4
 *
 * Every `You run on claude-fable-5` in every brief is false; all 18 panes run
 * `claude-opus-5`. So an agent's only source was a sentence somebody wrote months
 * ago, which means **the agents that answered him were more likely to be wrong
 * than the ones that refused.**
 *
 * ⭐ AND THE SENTENCE CANNOT BE FIXED BY REWRITING IT. Baron Draxum's brief said
 * `josh@stuff.io`; he is on `josh@book.io`, because he was migrated at ~21:58 the
 * night before when `josh@stuff.io` hit its weekly cap. His brief was CORRECT WHEN
 * WRITTEN and went stale when the thing it described moved. Editing 17 briefs
 * would break again at the next migration. **Read live state; do not restate it.**
 *
 * ⚠️ THREE TRAPS, ALL OF WHICH PRODUCED CLEAN, PLAUSIBLE, UNIFORM WRONG ANSWERS
 * while this was being investigated, two of them by the people investigating it:
 *
 *   1. The pane's direct child is the `bun` discord plugin, NOT `claude`. Reading
 *      it gives `<no --model flag>` for every agent, which looks like a finding.
 *      The claude process is a descendant, so the pid tree has to be walked.
 *   2. There are TWO `.claude.json` files. The default account's record sits
 *      BESIDE the config dir at `~/.claude.json` (132KB, written continuously);
 *      `~/.claude/.claude.json` is 624 bytes, carries no `oauthAccount`, and had
 *      not been touched in two days. Reading the decoy says the account is ABSENT.
 *      ⇒ `accounts.configFile()` already gets this right and its docblock already
 *      warned that resolving the path by hand reproduces #527. Two agents resolved
 *      it by hand anyway, in an investigation about this exact fact. **Use the
 *      helper.**
 *   3. `CLAUDE_CONFIG_DIR` is absent from the cmdline and present in the ENV, so
 *      `ps -o command=` cannot see it and `ps -Eww` can.
 *
 * 🔑 EVERY READER IS INJECTABLE so this is testable without a tmux server, a
 * process tree, or a signed-in account. The acceptance bar for #1304 was that
 * whatever gets built has a control that can return the other value; a module
 * that can only be run against the real machine cannot have one.
 */

const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const accounts = require('./accounts');

const HOME = () => process.env.AGENT_WORKFORCE_HOME || os.homedir();

const CALL_MS = 5000;

/* 🔑 ONE SHARED BUDGET FOR THE WHOLE LIVE READ (kosmos#1366), NOT THREE INDEPENDENT
   TIMEOUTS. Every exec in this module goes through `sh`, so a deadline threaded
   here bounds the whole read without making anything async and without changing
   the call graph. The card's own note expected this to need restructuring; it does
   not, because there is exactly one call site.
   ⚠️ OPT-IN ON PURPOSE. `deadline` absent means today's behaviour exactly, so
   `everyone()` and every other caller are unaffected until they ask to be bounded.
   That keeps the per-call 5s default a separate decision, which is what the card
   said it should be.
   📌 A SPENT BUDGET RETURNS '' - the same value a failed read already returns - so
   it lands on the fallback the callers ALREADY have rather than needing a new one.
   That is why this is small: the handling exists, only the trigger was missing. */
function sh(cmd, args, deadline) {
  let ms = CALL_MS;
  if (deadline != null) {
    const left = deadline - Date.now();
    /* Refuse rather than run with no time: a 0ms timeout is not a shorter read,
       it is a read that cannot succeed, and spending the process spawn to learn
       that is worse than answering from the record now. */
    if (left <= 0) return '';
    ms = Math.min(CALL_MS, left);
  }
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: ms }); } catch { return ''; }
}

/** session name -> pane pid, from tmux. */
function defaultPanes(deadline) {
  const out = sh('tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], deadline);
  const map = new Map();
  for (const line of String(out).split('\n')) {
    const m = line.match(/^(\S+)\s+(\d+)$/);
    if (m && !map.has(m[1])) map.set(m[1], Number(m[2]));
  }
  return map;
}

/** pid -> { ppid, command }, the whole table in one call. */
function defaultProcs(deadline) {
  const out = sh('ps', ['-eo', 'pid=,ppid=,command='], deadline);
  const map = new Map();
  for (const line of String(out).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] });
  }
  return map;
}

/** The ENVIRONMENT of one pid. `-E` is the whole point: see trap 3. */
function defaultEnvOf(pid, deadline) {
  return sh('ps', ['-Eww', '-o', 'command=', '-p', String(pid)], deadline);
}

/**
 * The `claude` process under a pane, found by walking DOWN the tree.
 *
 * ⚠️ Breadth-first and cycle-guarded. A pid table read in one shot can contain a
 * process whose parent has already exited and been recycled, and a naive walk on
 * that loops forever.
 */
function claudeUnder(panePid, procs) {
  const kids = new Map();
  for (const [pid, { ppid }] of procs) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const queue = [panePid];
  const seen = new Set();
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const rec = procs.get(pid);
    if (rec) {
      const first = String(rec.command).trim().split(/\s+/)[0] || '';
      /* Matched on the executable PATH ending in /claude, not on the string
         "claude" appearing anywhere: a pane running `grep claude` is not an
         agent, and neither is this module's own command line. */
      if (first.endsWith('/claude') || first === 'claude') return pid;
    }
    for (const k of kids.get(pid) || []) queue.push(k);
  }
  return null;
}

/**
 * What one agent is running on.
 *
 * Returns `{ ok, account, organization, model, configDir, because }`. On any
 * failure `ok` is false and `because` is a sentence, because "we could not tell"
 * and "it is running on nothing" are different answers and only one of them is
 * ever true.
 */
function runningAs(session, deps = {}) {
  /* `budgetMs` bounds the WHOLE live read, not each call (kosmos#1366). The route
     wants "answer or fall back", and three independent 5s timeouts gave a worst
     case equal to the client's own patience, so a slow reader produced NO answer
     where the record answer was available the whole time. */
  const deadline = deps.budgetMs != null ? Date.now() + deps.budgetMs : null;
  const panes = deps.panes || defaultPanes(deadline);
  const procs = deps.procs || defaultProcs(deadline);
  const envOf = deps.envOf || ((pid) => defaultEnvOf(pid, deadline));
  const identityOf = deps.identityOf || accounts.identityOf;

  const panePid = panes.get(session);
  if (panePid == null) {
    return { ok: false, because: `no pane called ${session} on this computer` };
  }
  const pid = claudeUnder(panePid, procs);
  if (pid == null) {
    /* ⚠️ NOT "it has no account". The pane exists and nothing is running in it we
       recognise, which is a different fact from an unreadable account. */
    return { ok: false, because: `nothing that looks like Claude Code is running under ${session}` };
  }

  const cmd = String((procs.get(pid) || {}).command || '');
  const modelMatch = cmd.match(/--model[= ](\S+)/);
  const env = String(envOf(pid) || '');
  const dirMatch = env.match(/CLAUDE_CONFIG_DIR=(\S+)/);
  const configDir = dirMatch ? dirMatch[1] : path.join(HOME(), '.claude');

  const id = identityOf(configDir);
  return {
    ok: true,
    /* null rather than a guess. An agent that says "I do not know" is behaving
       better than one that recites a stale sentence, which is the whole finding
       behind this card. */
    account: (id && id.email) || null,
    organization: (id && id.organization) || null,
    model: modelMatch ? modelMatch[1] : null,
    configDir,
    because: null,
  };
}

/** Every agent pane, so one call answers "who is on what". */
function everyone(deps = {}) {
  /* 🛑 `procs` IS HOISTED FOR THE SAME REASON `panes` ALWAYS WAS, AND ITS ABSENCE
     HERE WAS COSTING A FULL PROCESS-TABLE READ PER SESSION. `runningAs` falls back
     to `defaultProcs()` whenever `deps.procs` is missing, and this loop forwarded
     `panes` but not `procs`, so N panes meant N executions of `ps -eo` where one
     answers for all of them. The asymmetry is the tell: `panes` had to be hoisted
     because it drives the loop, and `procs` has exactly the same shape and was not.
     ⚠️ It compounds #1366 rather than merely being slow: each of those reads
     carries its own timeout, so the worst case scaled with the number of panes. */
  const deadline = deps.budgetMs != null ? Date.now() + deps.budgetMs : null;
  const panes = deps.panes || defaultPanes(deadline);
  const procs = deps.procs || defaultProcs(deadline);
  const out = [];
  for (const session of panes.keys()) {
    out.push({ session, ...runningAs(session, { ...deps, panes, procs }) });
  }
  return out.sort((a, b) => a.session.localeCompare(b.session));
}

/* `_sh` is exported for TESTABILITY and for no other reason,
   which is stated here so nobody reads them as API. kosmos#1366's budget is not
   observable through `runningAs`: injecting a dep is exactly what suppresses the
   behaviour under test, and a fake pid makes a real read return empty anyway, so
   both arms agree for the wrong reason. Without these the guard cannot go red, and
   a test that cannot go red is decoration. */
module.exports = { runningAs, everyone, claudeUnder, _sh: sh };
