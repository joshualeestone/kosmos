'use strict';
/**
 * "We are deliberately disrupting this agent right now." (#2019)
 *
 * 🔑 WHY THIS EXISTS, AND WHY IT IS ITS OWN MODULE. When a person restarts an
 * agent, changes its model or provider, changes its account, or edits its
 * instructions (which forces a restart), the agent leaves tmux for a moment.
 * The board's pane reader then sees a pane with no Claude process and calls it
 * STOPPED -- "this agent doesn't exist" -- to the very person who just clicked
 * Restart. "Gone" is the one thing we KNOW is false, because we are the ones
 * who took it out. This records that fact so the board can show a RESTARTING
 * state instead of an absence, for the short window a restart takes.
 *
 * 🛑 NO STATE HERE, EXACTLY LIKE liveness.js. This module records only that a
 * deliberate disruption BEGAN, with its CAUSE and WHEN. It never says what the
 * agent is doing; the state layer (status.reconcileReport) decides how to read
 * a dead pane while a fresh disruption is on file. Keeping the two apart is
 * what lets reconcileReport stay a pure function of its inputs.
 *
 * 🔑 THREE ANSWERS, NEVER TWO (the liveness discipline). `read` returns
 * found:false for "no record at all" -- which is every agent nobody has
 * disrupted -- and that is NOT the same as "disrupted long ago". `active`
 * folds the window in and returns the record only while it is fresh; past the
 * window it returns null and the board reverts to its normal absence reading,
 * so a stale record can never claim an agent is forever-restarting.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DIR = path.join(store.ROOT, 'disruptions');
const FILE_MODE = 0o600;

/* The causes a disruption can carry. A machine token, NOT display copy: the
   board renders the sentence ("Restarting agent" / "Switching to <model>")
   from this plus the card's existing model field, so the copy stays in the
   frontend's hands (#2019 is a MIXED card and the copy is the design half).
   An unknown cause is stored as 'restart', the honest generic, so a future
   caller cannot smuggle an unreadable token onto the board. */
const CAUSES = ['restart', 'model', 'provider', 'account', 'instructions'];

/* How long a dead pane keeps reading as RESTARTING before the board admits the
   restart did not come back.
   ⚠️ THIS BOUNDS ONLY THE FAILURE CASE. A restart that works ends the state
   the instant the pane has a Claude process again -- classify() stops
   returning STOPPED, so reconcileReport never reaches the disruption branch,
   window or no window (and status.snapshot clears the record outright on the
   first live reading, tightening it further). The window is therefore "how long
   we wait before we stop believing a restart that has NOT visibly come back",
   not "how long we show the animation". 180s is chosen on its OWN terms: a
   generous upper bound on a real restart -- a slow launchd bootstrap (KeepAlive
   throttles a relaunch by up to ~30s) plus a cold Claude boot -- so the old
   false-"gone" never trips before a genuine restart completes. Erring long is
   the safe direction: too short reintroduces the bug this card removes; too long
   only delays an honest failure message that the pane-alive check pre-empts
   anyway.
   📌 NOT COUPLED TO liveness.STALE_AFTER_MS even though both are 180s today
   (challenge iter 2): they are different facts -- that one is "how long after a
   heartbeat to still believe it", this one is "how long a restart may take" --
   so importing it would create a wrong coupling where tuning heartbeat cadence
   silently moved the restart window. They coincide; they are not the same
   number. Tunable, independently. */
const WINDOW_MS = 180 * 1000;

function fileFor(sessionName) {
  return path.join(DIR, store.safeKey(sessionName) + '.json');
}

/**
 * Record that a deliberate disruption of this agent has begun. Returns
 * {ok:true, cause, startedAt} or a refusal with a reason -- never throws at a
 * caller, because the caller is a restart path that must report its own
 * outcome, not crash on a bookkeeping write.
 */
function begin(sessionName, cause, atISO) {
  let file;
  try { file = fileFor(sessionName); } catch {
    return { ok: false, because: 'that agent name is not one we can keep a record under' };
  }
  const c = CAUSES.includes(cause) ? cause : 'restart';
  const startedAt = typeof atISO === 'string' && atISO ? atISO : new Date().toISOString();
  if (!Number.isFinite(Date.parse(startedAt))) {
    return { ok: false, because: 'that is not a time we can read' };
  }
  try {
    fs.mkdirSync(DIR, { recursive: true });
    /* One line, rewritten. Like liveness this is not a history: only the latest
       disruption means anything, and there is at most one in flight per agent. */
    fs.writeFileSync(file, JSON.stringify({ cause: c, startedAt }) + '\n', { mode: FILE_MODE });
  } catch (e) {
    return { ok: false, because: 'we could not write that down (' + (e && e.code || 'unknown') + ')' };
  }
  return { ok: true, cause: c, startedAt };
}

/**
 * The disruption record for this agent, if any.
 * 🔑 found:false means NO record -- never disrupted, or already cleared -- and
 * is deliberately not the same as a record that has aged out (that one is
 * found:true with a large ageMs; `active` is what folds the window in).
 */
function read(sessionName) {
  let file;
  try { file = fileFor(sessionName); } catch { return { found: false, because: 'unreadable agent name' }; }
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { found: false, because: 'no disruption has been recorded for this agent' };
    return { found: false, because: 'we could not read the disruption record' };
  }
  let rec;
  try { rec = JSON.parse(raw); } catch { return { found: false, because: 'the disruption record is not readable' }; }
  const startedAt = rec && rec.startedAt;
  const ms = Date.parse(startedAt || '');
  if (!Number.isFinite(ms)) return { found: false, because: 'the disruption record carries no readable time' };
  const cause = CAUSES.includes(rec && rec.cause) ? rec.cause : 'restart';
  return { found: true, cause, startedAt, ageMs: Date.now() - ms };
}

/**
 * The disruption record ONLY while it is fresh, else null.
 * ⚠️ This is what the state layer calls. Returning null past the window is the
 * self-heal: a restart that never came back stops reading as RESTARTING and the
 * board reverts to its honest absence reading, with no cleanup required.
 */
function active(sessionName, windowMs) {
  const r = read(sessionName);
  if (!r.found) return null;
  const w = Number.isFinite(windowMs) ? windowMs : WINDOW_MS;
  if (r.ageMs > w) return null;
  return { cause: r.cause, startedAt: r.startedAt, ageMs: r.ageMs };
}

/**
 * Drop an agent's disruption record. Optional -- `active` self-heals by the
 * window, so nothing is required to call this -- but a confirmed-alive caller
 * can use it to end the state the instant it has proof, and tests use it to
 * reset. Never throws.
 */
function clear(sessionName) {
  let file;
  try { file = fileFor(sessionName); } catch { return { ok: false, because: 'unreadable agent name' }; }
  try { fs.rmSync(file, { force: true }); } catch (e) {
    return { ok: false, because: 'we could not clear that (' + (e && e.code || 'unknown') + ')' };
  }
  return { ok: true };
}

module.exports = { DIR, WINDOW_MS, CAUSES, fileFor, begin, read, active, clear };
