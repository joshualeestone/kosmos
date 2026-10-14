'use strict';
/**
 * kosmos#6174: an agent moved to another account whose window could not be closed (the move came back partial with
 * its session still running) keeps running on its old account. The account list groups agents by their launch file,
 * which already names the new account, so the agent sat under the new account as if it ran there.
 *
 * The move route notes that session (server.js noteMoveOutcome: the SAME session start before and after the restart).
 * The agent is marked while its current session is still the noted one. A different session means it has restarted,
 * which is NOT proof it reached the new account: the launch job that was never booted out still holds the old account,
 * so a session it starts later (a crash, the agent exiting) can still run there, unmarked. That errs toward no mark,
 * never a wrong one; telling it apart would need launchd's loaded job, which is not read here. No session, or an
 * unreadable one, marks nobody. The move route clears a note on its next move; a list read drops one whose session is
 * readably another (clearIf, only that exact note, so it cannot race a move's write); a leftover note never marks.
 * Ways it can over-mark (each unmeasured on a real partial move): it reads the tmux SESSION, not the process, so a
 * process that restarted inside the same session onto the new account stays marked until the session changes; tmux
 * keeps the session start in whole seconds, so a session recreated within the same second reads as the same one;
 * and, below, a move back after two partial moves in a row. Only Claude account rows read and prune notes: a note
 * for another runner is cleared only by that agent's next move (it never marks).
 * `from` is the account the launch file named before the move, not one read from the process:
 * after an earlier partial move whose session has since changed, the two can differ, and a move back can then mark an
 * agent that already runs on the row's account (needs two partial moves in a row). The page states only the fact
 * ("still running on its old account"): whether a Kosmos restart then finishes the move is not measured here.
 *
 * { name: { started, from } } in one small file. Each write is atomic (tmp + rename), but note, clear and clearIf read,
 * change and write back with no lock, so two overlapping writes can lose one change: a lost note under-marks and a
 * lost prune leaves a harmless leftover, never a wrong mark. An unreadable or odd file reads as empty.
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

/** Any move outcome that is not a partial with the same session still running drops the note (noteMoveOutcome). */
function clear(name) {
  const d = readAll();
  if (!(name in d)) return true;
  delete d[name];
  return writeAll(d);
}

/**
 * Whether `name` is still running on the account it was moved from. `startedAt(name)` answers its current session's
 * start in ms, or null when there is none or it could not be read. Read only: the list prunes through clearIf, which
 * deletes only the exact note it read, and the move route clears on its next move. `all` (optional) is the notes
 * already read, so a list reads the file once per row.
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
