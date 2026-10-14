'use strict';
/**
 * kosmos#6174: an agent moved to another account whose restart could not finish (the move came back partial while
 * its session still ran) keeps running on its old account until it restarts. The account list groups agents by their
 * launch file, which already names the new account, so the agent sat under the new account as if it ran there.
 *
 * The move route reads the agent's session start BEFORE its restart attempt and, when the move comes back partial with
 * that very session still running (the same start), notes it. The agent counts as moving while its current session is
 * still that one (the same start): it runs on the old account. Any other session restarted onto the new account; no
 * session at all (stopped, or a relaunch that failed) runs nowhere. Neither is moving, and the note is dropped when
 * read. Tmux's own session start is the only reading (status.sessionStartedAtFromTmux), so a failed read (null)
 * marks nobody. Comparing the exact start, not a time window, means a restart that relaunched the agent but still
 * reported partial is never marked.
 *
 * { name: { started } } in one small file, atomic tmp + rename; an unreadable or odd file reads as empty.
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

/** The move route saved a move for `name` whose session, started at `started` (ms), is still running. */
function note(name, started) {
  if (typeof name !== 'string' || !name || !Number.isFinite(started)) return false;
  const d = readAll();
  d[name] = { started };
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
 * start in ms, or null when there is none or it could not be read.
 */
function isMoving(name, startedAt) {
  const rec = readAll()[name];
  if (!rec || !Number.isFinite(rec.started)) return false;
  let started = null;
  try { started = typeof startedAt === 'function' ? startedAt(name) : null; } catch { started = null; }
  if (!Number.isFinite(started)) return false;   // unreadable: never marked (the note stays for a later reading)
  if (started === rec.started) return true;    // the same session: still on its old account
  clear(name);   // another session: it has restarted onto the new account
  return false;
}

module.exports = { note, clear, isMoving, notes: readAll };
