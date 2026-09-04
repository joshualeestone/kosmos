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
 *      three-segment version (e.g. 2.1.212), so the "ours" PROCESS arm does NOT
 *      fire on a synthesized row. Ownership on win32 is therefore decided
 *      SOLELY by the claim column (isNamedOurs), i.e. by the record above.
 * The two are belt-and-suspenders: even were an unrecorded row ever emitted, the
 * process arm could not silently claim it.
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
    out = execFileSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 15000 });
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
      // FAIL CLOSED: emit ONLY sessions Kosmos created. An unrecorded session
      // (the operator's own) is never put on the board.
      if (!id || !Object.prototype.hasOwnProperty.call(owned, id)) continue;
      const rec = owned[id] || {};
      // The claim must MATCH the pane's name (status.isNamedOurs), so the emitted
      // name and claim are the SAME value. Prefer the recorded name (what Kosmos
      // filed it under) and fall back to the live name.
      const name = flat(rec.name || a.name || '');
      if (!name) continue; // a nameless row cannot be tied to an agent; skip it.
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

module.exports = { make, defaultRun, WIN32_COMMAND };
