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
 *   list-sessions first, then  marker g ; show-environment -s -g ; then per live session  marker i ;
 *   show-environment -s -t =<s>  (quoted: see parseQuoted).
 * The WHOLE environment is read, never one variable: `show-environment -t s CLAUDE_CONFIG_DIR` exits 1 where it is
 * unset, and tmux stops a `;` sequence at its first error (measured 2026-10-13). The marker is literal, because
 * `#{session_name}` expands to nothing in a client-less display-message (measured). Batches are a COUNT (40), not a
 * byte budget: about 180 short names fit under tmux's "command too long" limit, but 40 very long names do not, and
 * that batch then answers unknown (fail-safe; Kosmos names are at most 32 characters, engine/create.js).
 *
 * Answer per name, three states. The fail-safe direction is the whole point:
 *   a string   the session environment pins CLAUDE_CONFIG_DIR to that folder
 *   ''         the session pins nothing, or removes the variable, AND the server has no global value: the default
 *   null       UNKNOWN: no such session; tmux could not be asked; the answer could not be read; or the session
 *              pins nothing while the server HAS a global value (it may have inherited it, or a different one if the
 *              global changed since it started); or it removes the variable while the server has one (a name can
 *              forge a removal line, review 3); or its value is set but empty
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

/* Review 2: values are read QUOTED (show-environment -s) and parsed as a stream, never split into lines. tmux prints
   a raw value as-is, so a value holding a newline could print a line that reads as another entry ("unset
   CLAUDE_CONFIG_DIR;") or as a marker. With -s every value sits between double quotes with " $ \ and backtick escaped
   (measured, tmux 3.6a), so text inside a value is consumed as the value and can never be read as an entry or a
   marker. Statements are exactly  NAME="<escaped>"; export NAME;  or  unset NAME;  and anything else makes the whole
   batch unknown. */
/* Review 3: any name tmux accepts (it refuses only '='; a bash-exported function is BASH_FUNC_f%%). A narrower
   pattern defended nothing and turned EVERY read unknown on a server whose global held one such name. */
const NAME_RE = /^[^=\n]+$/;

/* Parse one batch's output. order: the markers expected, in order ('g', '0', '1', ...). Returns the
   CLAUDE_CONFIG_DIR entry per block ({ set } | { removed } | {}) or null when the output is not that exact shape. */
function parseQuoted(text, order) {
  const blocks = [];
  let next = 0;
  let i = 0;
  const lineEnd = (from) => { const n = text.indexOf('\n', from); return n < 0 ? text.length : n; };
  while (i < text.length) {
    const end = lineEnd(i);
    const head = text.slice(i, end);
    if (head.startsWith(MARK)) {
      if (next >= order.length || head !== MARK + order[next]) return null;
      blocks.push({});
      next += 1;
      i = end + 1;
      continue;
    }
    if (!blocks.length) return null;   // output before the first marker: not the shape asked for
    const cur = blocks[blocks.length - 1];
    const unset = /^unset ([^=\n]+);$/.exec(head);
    if (unset) {
      if (unset[1] === 'CLAUDE_CONFIG_DIR') { if ('set' in cur || cur.removed) return null; cur.removed = true; }
      i = end + 1;
      continue;
    }
    const eq = text.indexOf('="', i);
    if (eq < 0) return null;   // a '="' on a later line leaves a newline in the name, which NAME_RE refuses
    const name = text.slice(i, eq);
    if (!NAME_RE.test(name)) return null;
    let j = eq + 2;
    let value = '';
    for (;;) {
      if (j >= text.length) return null;
      const c = text[j];
      if (c === '\\') { if (j + 1 >= text.length) return null; value += text[j + 1]; j += 2; continue; }
      if (c === '"') break;
      value += c;
      j += 1;
    }
    const tail = '; export ' + name + ';';
    if (!text.startsWith(tail, j + 1)) return null;
    const after = j + 1 + tail.length;
    if (after < text.length && text[after] !== '\n') return null;
    if (name === 'CLAUDE_CONFIG_DIR') { if ('set' in cur || cur.removed) return null; cur.set = value; }
    i = after + 1;
  }
  if (next !== order.length) return null;
  return blocks;
}

/* One batch: the global block first, then one block per session, each opened by its marker exactly once and in
   order. Anything else answers null for the whole batch: no session is ever credited with another's value. */
function readBatch(run, ask) {
  const args = ['display-message', '-p', '-t', '=' + ask[0], MARK + 'g', ';', 'show-environment', '-s', '-g'];
  ask.forEach((n, i) => args.push(';', 'display-message', '-p', '-t', '=' + n, MARK + i, ';', 'show-environment', '-s', '-t', '=' + n));
  let got = run(args);
  // A session that went away between the listing and this read stops the sequence; try once more before giving up.
  if (!got || !got.ran || got.status !== 0) got = run(args);
  if (!got || !got.ran || got.status !== 0 || typeof got.out !== 'string') return null;
  const blocks = parseQuoted(got.out, ['g', ...ask.map((_, i) => String(i))]);
  return blocks ? { global: blocks[0], sessions: blocks.slice(1) } : null;
}

/* Review 2: a name tmux reads specially in a target or a command line ($x, a trailing ;) fails the whole sequence,
   so one such session would make its whole batch unknown on every read. Kosmos names its sessions from agent names;
   anything outside this set is answered unknown without asking. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
  const ask = wanted.filter((n) => live.has(n) && SAFE_NAME.test(n));

  const size = Number.isInteger(o.batch) && o.batch > 0 ? o.batch : BATCH;
  for (let at = 0; at < ask.length; at += size) {
    const part = ask.slice(at, at + size);
    const read = readBatch(run, part);
    if (!read) continue;
    const globalSet = 'set' in read.global;
    part.forEach((n, i) => {
      const e = read.sessions[i];
      if ('set' in e) { if (e.set !== '') out.set(n, e.set); }   // set but empty: what the runner does with it is unknown
      /* Review 3: names print UNquoted, and a name may hold a newline, so a session-level removal line can be forged
         (tmux refuses '=' in a name, so a forged SET cannot). The supervisor never removes the variable per session,
         so a removal while the server has a global value is answered unknown rather than trusted. */
      else if (e.removed) { if (!globalSet) out.set(n, ''); }
      else if (!globalSet) out.set(n, '');
      // else: no entry of its own while the server has a global value: it may have inherited it. Unknown.
    });
  }
  return out;
}

module.exports = { sessionClaudeDirs, parseQuoted, MARK, BATCH };
