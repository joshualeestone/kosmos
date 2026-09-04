'use strict';
/**
 * The win32 create-side of the paneless roster (#570): mint a session id, write
 * the ownership record, and hand back the launch arguments that pin that id.
 *
 * 🛑 WHY THIS EXISTS. On a Mac, "this session is Kosmos's" is stamped by the
 * startup script running `tmux set-option @kosmos_agent <name>` at every session
 * start (engine/create.js writes the plist; bin/agent-supervisor.sh does the
 * stamp). Windows has no tmux and no launchd. There the ownership mark is a row
 * in engine/win32sessions (the fail-closed record the roster reads), keyed on the
 * session's UUID. But that UUID is Claude's, not ours -- `claude agents --json`
 * reports whatever id the session runs under. So to record a session we must
 * KNOW its id, and the only way to know it before the session exists is to PIN
 * it: `claude --session-id <uuid>` makes the session run under an id we chose.
 *
 * 🔑 THE PIN IS MEASURED, NOT ASSUMED (2026-09-04, on this Mac). An interactive
 * `claude --session-id <uuid>` came back from `claude agents --json` as
 * `{ sessionId: <uuid>, kind: "interactive" }` -- the exact id passed in. So the
 * id this module mints, records, and puts in launchArgs is the id the roster will
 * later see live. TWO constraints fell out of that measurement and both bind the
 * spawn that consumes launchArgs:
 *   1. The spawn MUST be interactive. `claude --bg` prints
 *      "--bg manages the session id; ignoring --session-id" and mints its own --
 *      so a backgrounded session would never carry the id we recorded, and the
 *      roster (fail-closed) would never emit it. The win32 agent is an
 *      interactive session, the same kind Mac agents are. Neither win32roster
 *      nor win32sessions inspects the `kind` field, so this is a constraint on
 *      the SPAWN, not a check either module enforces today.
 *   2. A fresh top-level session only registers in `claude agents --json` when it
 *      is NOT a child of another Claude session (a `CLAUDE_CODE_CHILD_SESSION`
 *      environment marker suppresses registration and turns transcript saving
 *      off). The spawn must start claude as its own top-level process, not as a
 *      child of the board's node process carrying that marker. This is a spawn
 *      concern, noted here because it is invisible until a session silently fails
 *      to appear on the board.
 *
 * 🔑 ONE MINT POINT. The id goes to TWO places -- the ownership record AND the
 * `--session-id` launch flag -- and those two MUST be the same value or the board
 * records one session and Claude runs another, leaving the live session
 * unrecorded (invisible, fail-closed) forever. Minting inside prepareSession and
 * returning both the id and the launchArgs that carry it makes them the same
 * value BY CONSTRUCTION; a caller that minted its own id and recorded separately
 * is a second place for the two to disagree (the exact "two copies of one fact"
 * defect this codebase keeps paying for). The caller never mints; it spawns with
 * launchArgs verbatim.
 *
 * 📌 SCOPE. This module is the RECORD + ARG producer, unit-tested on a Mac
 * through the real store. The interactive spawn it feeds -- starting claude with
 * these args on Windows, and keeping it alive (the analog of the launchd job +
 * supervisor loop the Mac path installs) -- is Windows-runtime plumbing built and
 * measured on a real box, not here. It consumes prepareSession()'s launchArgs and
 * calls abandon() if the spawn never starts. Deliberately NOT wired into
 * create.js's launch path yet: create.js launches only via launchctl/plist
 * (Mac), and recording a session that no spawn will start would file ownership of
 * a session that never goes live -- harmless to the roster (nothing live matches
 * it) but a lie in the record. The record is written at the moment a real spawn
 * is about to happen, which is where the win32 launch branch will call this.
 */
const crypto = require('node:crypto');
const win32sessions = require('./win32sessions');

/**
 * Mint a session id, record it as Kosmos-owned, and return the launch args that
 * pin it. Call this immediately before spawning the interactive win32 agent.
 *
 * @param {{ name: string, runner?: string }} meta the Kosmos agent name (the
 *   claim the roster emits and status.isNamedOurs matches) and the runner
 *   ('claude' | 'codex'), the same vocabulary win32sessions.record and the roster
 *   already use -- no private words.
 * @returns {{ ok: true, sessionId: string, launchArgs: string[] }
 *           | { ok: false, because: string }}
 *   On success, sessionId is the id to pass to the spawn (it is already in
 *   launchArgs) and launchArgs is ['--session-id', sessionId] to splice into the
 *   claude argv. On failure (a name the record refuses -- blank or invisible --,
 *   or a store write fault) nothing was recorded and there is nothing to abandon;
 *   `because` is the record's own reason, spoken plainly.
 */
function prepareSession(meta) {
  // crypto.randomUUID gives a canonical v4 UUID: the shape `claude --session-id`
  // accepts (measured) and one win32sessions.validId passes (hyphens are in its
  // charset). A v4 collision with an existing record is ~0, so we do not probe
  // for one -- and record() would overwrite rather than corrupt if it ever did.
  const sessionId = crypto.randomUUID();
  // record() is the single gate on name/runner AND the single normalizer of them
  // (it applies the same string-or-'' defaulting to whatever object it is handed,
  // and reads only name/runner, ignoring extras). So pass `meta` straight through
  // -- re-defaulting name/runner here would be a second copy of that logic and a
  // second place for the two to disagree. If record refuses (blank/invisible
  // name) or cannot write, NOTHING landed -- the minted id was never handed out
  // -- so we surface its reason and there is nothing to undo. The spawn must not
  // start on a failure here (no id was recorded, so the session would be
  // unrecorded and invisible on the board).
  const r = win32sessions.record(sessionId, meta);
  if (!r.ok) return { ok: false, because: r.because };
  return { ok: true, sessionId, launchArgs: ['--session-id', sessionId] };
}

/**
 * Drop a prepared session from the record. Call this when the spawn that would
 * have started `sessionId` never started (the launch failed), so the record does
 * not keep a row for a session that will never go live. Leaving the row is
 * harmless to the roster -- it emits only sessions that are BOTH recorded AND
 * live in `claude agents --json`, and a session that never started is never live
 * -- but abandon() keeps the record honest and bounded, matching create.js's own
 * rollback discipline on a failed Mac start.
 *
 * @param {string} sessionId the id returned by a prior prepareSession.
 * @returns {{ ok: boolean, because?: string }} win32sessions.forget's result
 *   verbatim (ok:true when the row is gone or was never there).
 */
function abandon(sessionId) {
  return win32sessions.forget(sessionId);
}

module.exports = { prepareSession, abandon };
