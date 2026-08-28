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

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 }); } catch { return ''; }
}

/** session name -> pane pid, from tmux. */
function defaultPanes() {
  const out = sh('tmux', ['list-panes', '-a', '-F', '#{session_name} #{pane_pid}']);
  const map = new Map();
  for (const line of String(out).split('\n')) {
    const m = line.match(/^(\S+)\s+(\d+)$/);
    if (m && !map.has(m[1])) map.set(m[1], Number(m[2]));
  }
  return map;
}

/** pid -> { ppid, command }, the whole table in one call. */
function defaultProcs() {
  const out = sh('ps', ['-eo', 'pid=,ppid=,command=']);
  const map = new Map();
  for (const line of String(out).split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] });
  }
  return map;
}

/** The ENVIRONMENT of one pid. `-E` is the whole point: see trap 3. */
function defaultEnvOf(pid) {
  return sh('ps', ['-Eww', '-o', 'command=', '-p', String(pid)]);
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
  const panes = deps.panes || defaultPanes();
  const procs = deps.procs || defaultProcs();
  const envOf = deps.envOf || defaultEnvOf;
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
  const panes = deps.panes || defaultPanes();
  const out = [];
  for (const session of panes.keys()) {
    out.push({ session, ...runningAs(session, { ...deps, panes }) });
  }
  return out.sort((a, b) => a.session.localeCompare(b.session));
}

module.exports = { runningAs, everyone, claudeUnder };
