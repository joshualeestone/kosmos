'use strict';
/**
 * kosmos#6174: an agent moved to another account whose restart could not finish (the move came back partial while
 * its session still ran) keeps running on its old account until it restarts. The account list groups agents by their
 * launch file, which already names the new account, so the agent sat under the new account as if it ran there.
 *
 * The move route notes the session left running on the old account (server.js noteMoveOutcome): the SAME session as
 * before the restart, when the window could not be closed. The agent counts as moving while its current session is still the noted one (the same start). Any other
 * session restarted onto the new account; no session at all (stopped, or a relaunch that failed) runs nowhere. Neither
 * is moving; the move route clears the note on its next move, a list read drops one whose session is readably another
 * (clearIf, only that very note), and a leftover note never marks (it needs the very same session). The reading is the agent's own session (the pane roster) and its tmux start, so a failed read (null)
 * marks nobody. Comparing the exact start, not a time window, means a restart that relaunched the agent onto the new
 * account is never marked.
 *
 * { name: { started, from } } in one small file, atomic tmp + rename; an unreadable or odd file reads as empty.
 */
const fs = require('node:fs');
const path = require('node:path');

function file() { return path.join(require('./store').ROOT, 'account-moving.json'); }

function readAll() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}

function writeAll(d) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    require('./store').saveFlushed(file(), JSON.stringify(d));
    return true;
  } catch { return false; }
}

/** The move route saved a move for `name` whose session, started at `started` (ms), is still running, on the account
    folder `from` (null: the default account). */
function note(name, started, from = null) {
  if (typeof name !== 'string' || !name || !Number.isFinite(started)) return false;
  const d = readAll();
  d[name] = { started, from: typeof from === 'string' && from ? from : null };
  return writeAll(d);
}

/** A move that restarted the agent (or any later successful move) needs no note. */
function clear(name) {
  const d = readAll();
  if (!(name in d)) return true;
  delete d[name];
  return writeAll(d);
}

/**
 * Whether `name` is still running on the account it was moved from. `startedAt(name)` answers its current session's
 * start in ms, or null when there is none or it could not be read. Read only (review 4): a stale note is harmless,
 * since it marks only while the very same session runs, and clearing here would race the move route's write. The move
 * route is the one writer that clears. `all` (optional) is the notes already read, so a list reads the file once.
 */
function isMoving(name, startedAt, all) {
  const rec = (all && typeof all === 'object' ? all : readAll())[name];
  if (!rec || !Number.isFinite(rec.started)) return false;
  let started = null;
  try { started = typeof startedAt === 'function' ? startedAt(name) : null; } catch { started = null; }
  return Number.isFinite(started) && started === rec.started;   // the same session: still on its old account
}

/** Drop `name`'s note only if it is still the one for session start `started`: a list read can prune a note that can
    never mark again without racing a move that just wrote a new one. */
function clearIf(name, started) {
  const d = readAll();
  if (!d[name] || d[name].started !== started) return false;
  delete d[name];
  return writeAll(d);
}

module.exports = { note, clear, clearIf, isMoving, notes: readAll };
