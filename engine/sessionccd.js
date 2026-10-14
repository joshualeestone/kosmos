'use strict';
/**
 * #6095: the Claude config folder each agent's tmux session ACTUALLY runs under.
 *
 * A default-account agent's job has no configDir, so everything that reads the job (status rows' account.dir,
 * pluginreach) concludes it runs in the person's own ~/.claude. That is wrong when the tmux SERVER carries a leaked
 * global CLAUDE_CONFIG_DIR. Two ways it reaches a pane:
 *   - bin/agent-supervisor.sh (the EFFECTIVE_CCD block, Claude runner only) PINS it: `tmux new-session -e
 *     CLAUDE_CONFIG_DIR=<dir>`, which sets the SESSION environment, and `show-environment -t <s>` reads it back;
 *   - any other session (another runner, an older supervisor, one made by hand) INHERITS the server's global value
 *     at the moment it starts, and that never shows in the session's own environment (review 1, measured).
 *
 * One tmux call per batch of sessions, not one each (a status read is polled):
 *   list-sessions first, then  marker g ; show-environment -g ; then per live session  marker i ; show-environment -t =<s>.
 * The WHOLE environment is read, never one variable: `show-environment -t s CLAUDE_CONFIG_DIR` exits 1 where it is
 * unset, and tmux stops a `;` sequence at its first error (measured 2026-10-13). The marker is literal, because
 * `#{session_name}` expands to nothing in a client-less display-message (measured). Batches stay well under tmux's
 * "command too long" limit (review 1: about 180 short names fit in one).
 *
 * Answer per name, three states. The fail-safe direction is the whole point:
 *   a string   the session environment pins CLAUDE_CONFIG_DIR to that folder
 *   ''         the session pins nothing AND the server has no global value (or the session removes it): the default
 *   null       UNKNOWN: no such session; tmux could not be asked; the answer could not be read; or the session
 *              pins nothing while the server HAS a global value (it may have inherited it, or a different one if the
 *              global changed since it started)
 * A caller must treat null as "do not know", never as "default folder".
 *
 * Known limit: a session that inherited a global value which was later REMOVED from the server reads ''. tmux keeps
 * no record of what a session inherited; only the process's own environment holds it.
 */

const { execFileSync } = require('node:child_process');

const MARK = '@@kosmos-6095@@';
const BATCH = 40;

function tmuxBin() {
  return process.env.AGENT_WORKFORCE_TMUX_BIN || 'tmux';
}

/* Run tmux and keep the outcome (the status.js shDetail shape): ran=false means it never started or timed out. */
function runTmux(args, opts) {
  const o = opts || {};
  try {
    return { ran: true, status: 0, out: execFileSync(o.bin || tmuxBin(), [...(o.prefixArgs || []), ...args], { encoding: 'utf8', timeout: o.timeoutMs || 5000 }) };
  } catch (e) {
    const status = e && typeof e.status === 'number' ? e.status : null;
    return { ran: status !== null, status, out: (e && e.stdout && e.stdout.toString()) || '' };
  }
}

/* What an environment listing says about CLAUDE_CONFIG_DIR: { set: '<dir>' } | { removed: true } | {} (no entry).
   The last line wins, as in tmux. */
function ccdEntry(lines) {
  let e = {};
  for (const line of lines) {
    if (line.startsWith('CLAUDE_CONFIG_DIR=')) e = { set: line.slice('CLAUDE_CONFIG_DIR='.length) };
    else if (line === '-CLAUDE_CONFIG_DIR') e = { removed: true };
  }
  return e;
}

/* One batch: the global block first, then one block per session, each opened by its marker exactly once and in
   order. Anything else (a missing, repeated or out-of-order marker, as a raw newline inside some value could forge)
   answers null for the whole batch: no session is ever credited with another's value. */
function readBatch(run, ask) {
  const args = ['display-message', '-p', '-t', '=' + ask[0], MARK + 'g', ';', 'show-environment', '-g'];
  ask.forEach((n, i) => args.push(';', 'display-message', '-p', '-t', '=' + n, MARK + i, ';', 'show-environment', '-t', '=' + n));
  let got = run(args);
  // A session that went away between the listing and this read stops the sequence; try once more before giving up.
  if (!got || !got.ran || got.status !== 0) got = run(args);
  if (!got || !got.ran || got.status !== 0 || typeof got.out !== 'string') return null;
  const order = ['g', ...ask.map((_, i) => String(i))];
  const blocks = [];
  let next = 0;
  for (const line of got.out.split('\n')) {
    if (line.startsWith(MARK)) {
      if (next >= order.length || line !== MARK + order[next]) return null;
      blocks.push([]);
      next += 1;
      continue;
    }
    if (!blocks.length) return null;   // output before the first marker: not the shape asked for
    blocks[blocks.length - 1].push(line);
  }
  if (next !== order.length) return null;
  return { global: ccdEntry(blocks[0]), sessions: blocks.slice(1).map(ccdEntry) };
}

/**
 * names: session names to ask about. opts: { run } to replace the tmux call (tests), { bin, prefixArgs } to aim it
 * (a private socket in a test), { batch } for the batch size. Returns a Map name -> string | '' | null.
 */
function sessionClaudeDirs(names, opts) {
  const o = opts || {};
  const run = o.run || ((args) => runTmux(args, o));
  const wanted = [...new Set((Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n !== ''))];
  const out = new Map(wanted.map((n) => [n, null]));
  if (!wanted.length) return out;

  const listed = run(['list-sessions', '-F', '#{session_name}']);
  if (!listed || !listed.ran || listed.status !== 0 || typeof listed.out !== 'string') return out;
  const live = new Set(listed.out.split('\n').filter(Boolean));
  const ask = wanted.filter((n) => live.has(n));

  const size = Number.isInteger(o.batch) && o.batch > 0 ? o.batch : BATCH;
  for (let at = 0; at < ask.length; at += size) {
    const part = ask.slice(at, at + size);
    const read = readBatch(run, part);
    if (!read) continue;
    const globalSet = read.global.set !== undefined;
    part.forEach((n, i) => {
      const e = read.sessions[i];
      if (e.set !== undefined) out.set(n, e.set);
      else if (e.removed) out.set(n, '');
      else if (!globalSet) out.set(n, '');
      // else: no entry of its own while the server has a global value: it may have inherited it. Unknown.
    });
  }
  return out;
}

module.exports = { sessionClaudeDirs, ccdEntry, MARK, BATCH };
