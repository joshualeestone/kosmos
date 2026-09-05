'use strict';
/**
 * The win32 roster provider: the Windows source for `status.setPaneSource` (#570).
 *
 * On a Mac the roster comes from `tmux list-panes` formatted as PANE_COLUMNS.
 * Windows has no tmux. `claude agents --json` is the server-invokable
 * replacement (windows-orchestrator proved it on the box, and it needs no
 * running agent): it lists the machine's Claude sessions with
 * { pid, cwd, kind, startedAt, sessionId, name, status }. This module turns that
 * JSON into the exact PANE_COLUMNS tab-separated text `status.parsePanes`
 * already reads, so the entire engine ownership + classification path is reused
 * UNCHANGED behind the source seam ("replaces where the TEXT comes from, never
 * what is done with it").
 *
 * 🛑 TWO FAIL-CLOSED PROPERTIES, because `claude agents --json` lists EVERY
 * Claude session including the operator's own, and the board must manage only
 * Kosmos's:
 *   1. EMIT ONLY RECORDED SESSIONS. A row is produced only for a live session
 *      whose sessionId is in `win32sessions` (the Kosmos-created record). An
 *      unrecorded session -- the operator's own -- is never emitted, so no code
 *      path on the board ever touches it.
 *   2. command = "claude.exe", NOT a version string. `status.isClaudeCommand`
 *      accepts "claude.exe" so an emitted row classifies as a real agent
 *      (typeable / restartable), but `status.isNativeClaude` matches ONLY a
 *      three-segment version (e.g. 2.1.212), so the ownership PROCESS arm
 *      (`isNativeClaude(command)`) does NOT fire on a synthesized row.
 *
 * 🛑 PROPERTY 1 IS THE LOAD-BEARING ONE; PROPERTY 2 IS NOT AN INDEPENDENT
 * BACKSTOP. It is tempting to say "even if an unrecorded row were emitted, the
 * process arm could not claim it, so property 2 alone is a safety net." That is
 * FALSE, and stating it would invite someone to lean on property 2. `isNamedOurs`
 * has a legacy arm that matches a session NAME ending in `-discord`, entirely
 * independent of the claim column and of the command -- so an unrecorded row
 * named `*-discord` with an empty claim WOULD read as ours despite property 2.
 * Property 2 defeats only the isNativeClaude PROCESS arm; it does not neutralize
 * the `-discord$` NAME arm. What actually closes the hole is property 1: an
 * unrecorded session is never emitted at all, so no such row exists to be claimed
 * by any arm. Operator `claude agents --json` sessions are named like `agent1-d2`,
 * not `*-discord`, so this is not reachable today -- but the guarantee is
 * property 1, and property 2 is a defense-in-depth that narrows, not closes.
 *
 * ⚠️ A read failure returns NULL, never "". `listPanes` treats null as "we could
 * not see what is running" and refuses honestly, exactly as a failed
 * `tmux list-panes` does. Returning "" would report an empty machine off a look
 * that never happened -- the false-zero this whole module family exists to stop.
 */
const { execFileSync } = require('node:child_process');
const win32sessions = require('./win32sessions');

/* The synthesized command. See the header: classifies as a Claude agent via
   isClaudeCommand, but is NOT a version string, so the ownership process arm
   (isNativeClaude) stays off and the claim is the sole ownership evidence. */
const WIN32_COMMAND = 'claude.exe';

/* A tab or newline in a field would break the PANE_COLUMNS framing (tab-separated,
   one row per line). Agent names from `claude agents --json` do not contain them,
   but a field is caller-external text, so flatten defensively rather than smuggle
   a row break. */
function flat(v) {
  return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
}

/**
 * Default exec: run `claude agents --json` and parse it. Returns the array, or
 * null on ANY failure (claude missing, non-zero exit, unparseable) so the caller
 * refuses honestly. Never throws.
 */
function defaultRun() {
  let out;
  try {
    // Resolve `claude` through the codebase's ONE runner-resolution seam
    // (engine/runners.resolveBin) so the AGENT_WORKFORCE_CLAUDE_BIN sandbox
    // override is honoured, exactly like every other claude invocation
    // (connect/create/machine/subscription) rather than a second bare `claude`.
    const bin = require('./runners').resolveBin('claude').bin;
    // ⚠️ maxBuffer RAISED to 16 MiB for the SAME reason machine.js:43-50 did:
    // a busy machine with many concurrent sessions makes `claude agents --json`
    // large (long cwd/name fields), and Node's 1 MiB default would make
    // execFileSync throw -> null -> the whole roster blanks on a healthy box.
    out = execFileSync(bin, ['agents', '--json'], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(out); } catch { return null; }
  return Array.isArray(parsed) ? parsed : null;
}

/**
 * Build the paneSource function to hand to `status.setPaneSource` on win32.
 *
 * @param {object} [opts]
 * @param {() => (Array|null)} [opts.run] the `claude agents --json` reader,
 *   injectable for tests; returns the parsed array or null on failure.
 * @param {{ read: () => object }} [opts.record] the ownership record (default
 *   the real win32sessions), injectable for tests.
 * @returns {() => (string|null)} a paneSource: PANE_COLUMNS text, or null on a
 *   failed look.
 */
function make(opts) {
  const run = opts && typeof opts.run === 'function' ? opts.run : defaultRun;
  const record = opts && opts.record ? opts.record : win32sessions;
  return function win32PaneSource() {
    const agents = run();
    // NULL, not "": a failed look must refuse, never read as an empty machine.
    if (!Array.isArray(agents)) return null;
    const owned = record.read();
    const lines = [];
    for (const a of agents) {
      if (!a || typeof a !== 'object') continue;
      const id = a.sessionId;
      // Re-validate the live id against the SAME gate record() writes under, so the
      // record store is the sole trust root EXPLICITLY, not merely by construction.
      // Without this the loop would trust that owned's keys are all well-formed; that
      // holds today (record() enforces validId), but a hand-corrupted store plus a
      // matching live id is the one path it does not close -- e.g. JSON.parse of
      // `{"__proto__":...}` yields an OWN "__proto__" key, which validId rejects here.
      if (!win32sessions.validId(id)) continue;
      // FAIL CLOSED: emit ONLY sessions Kosmos created. An unrecorded session
      // (the operator's own) is never put on the board.
      if (!Object.prototype.hasOwnProperty.call(owned, id)) continue;
      const rec = owned[id] || {};
      // The claim must MATCH the pane's name (status.isNamedOurs), so the emitted
      // name and claim are the SAME value. Prefer the recorded name (what Kosmos
      // filed it under) and fall back to the live name.
      const name = flat(rec.name || a.name || '');
      // Re-check the name against the SAME visible-char gate record() writes under,
      // for the SAME reason validId is re-checked above: a hand-corrupted store could
      // hold a whitespace/zero-width name that a bare truthiness test (and status.js's
      // own .trim(), which does not strip U+200B) would pass, emitting a degenerate
      // invisible row that reads as ours. One definition (win32sessions.validName),
      // two call sites -- symmetric with the id gate, not a duplicated regex.
      if (!win32sessions.validName(name)) continue;
      const runner = flat(rec.runner || '');
      // PANE_COLUMNS order: session \t pane \t command \t inMode \t claim \t runner \t title
      // pane "0.0" (one synthetic pane per session); inMode "0" (never copy-mode
      // -> typeable); command WIN32_COMMAND (agent, not process-arm-ours); claim
      // = name (ownership); title = name (state comes from the capture seam, not
      // the roster).
      lines.push([name, '0.0', WIN32_COMMAND, '0', name, runner, name].join('\t'));
    }
    // Trailing newline so the last row parses like every other (matches tmux's
    // own output shape); an empty roster is a valid, readable answer (no agents),
    // which is what unblocks create's "couldn't check which agents are running".
    return lines.length ? lines.join('\n') + '\n' : '';
  };
}

module.exports = { make, defaultRun, WIN32_COMMAND, flat };
