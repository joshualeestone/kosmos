'use strict';
/**
 * #6095: the Claude config folder each agent's tmux session ACTUALLY runs under.
 *
 * A default-account agent's job has no configDir, so everything that reads the job (status rows' account.dir,
 * pluginreach) concludes it runs in the person's own ~/.claude. That is wrong when bin/agent-supervisor.sh pinned the
 * pane to a leaked tmux-global CLAUDE_CONFIG_DIR (the EFFECTIVE_CCD block): it starts the session with
 * `tmux new-session -e CLAUDE_CONFIG_DIR=<dir>`, which sets the SESSION environment. `tmux show-environment -t <s>`
 * reads that back, so tmux itself holds the truth and nothing here keeps a second copy of it.
 *
 * One tmux call for every session asked about, not one each (a status read is polled):
 *   list-sessions first, then for each live session `display-message -p <marker>` ; `show-environment -t =<s>`.
 * The WHOLE environment is read, never one variable: `show-environment -t s CLAUDE_CONFIG_DIR` exits 1 on a session
 * where it is unset, and tmux stops a `;` sequence at its first error, so every later session would go unread
 * (measured 2026-10-13). The marker is written literally (index), because `#{session_name}` expands to nothing in a
 * client-less display-message.
 *
 * Answer per name, three states, and the fail-safe direction is the whole point:
 *   a string   the session environment pins CLAUDE_CONFIG_DIR to that folder
 *   ''         the session is live and pins nothing (a clean launch: the default folder)
 *   null       UNKNOWN: no such session, tmux could not be asked, or the answer could not be read
 * A caller must treat null as "do not know", never as "default folder".
 */

const { execFileSync } = require('node:child_process');

const MARK = '@@kosmos-6095@@';

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

/* The value a session's environment listing gives CLAUDE_CONFIG_DIR: the folder, '' when unset or removed. */
function ccdFromEnvLines(lines) {
  let v = '';
  for (const line of lines) {
    if (line.startsWith('CLAUDE_CONFIG_DIR=')) v = line.slice('CLAUDE_CONFIG_DIR='.length);
    else if (line === '-CLAUDE_CONFIG_DIR') v = '';
  }
  return v;
}

/**
 * names: session names to ask about. opts: { run } to replace the tmux call (tests), and { bin, prefixArgs } to
 * aim it (a private socket in a test). Returns a Map name -> string | '' | null, with one entry per distinct name.
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
  if (!ask.length) return out;

  const args = [];
  ask.forEach((n, i) => {
    if (i) args.push(';');
    args.push('display-message', '-p', '-t', '=' + n, MARK + i, ';', 'show-environment', '-t', '=' + n);
  });
  const got = run(args);
  // A failed sequence stopped somewhere unknown: answer nothing rather than half of it.
  if (!got || !got.ran || got.status !== 0 || typeof got.out !== 'string') return out;

  const blocks = new Map();
  let cur = null;
  for (const line of got.out.split('\n')) {
    if (line.startsWith(MARK)) {
      const i = Number(line.slice(MARK.length));
      cur = Number.isInteger(i) && i >= 0 && i < ask.length && !blocks.has(i) ? i : null;
      if (cur !== null) blocks.set(cur, []);
      continue;
    }
    if (cur !== null) blocks.get(cur).push(line);
  }
  ask.forEach((n, i) => { if (blocks.has(i)) out.set(n, ccdFromEnvLines(blocks.get(i))); });
  return out;
}

module.exports = { sessionClaudeDirs, ccdFromEnvLines, MARK };
