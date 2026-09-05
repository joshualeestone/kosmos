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
 * 🔑 AND THE SAME ARGUMENT MINTS THE SENDER TOKEN (#570 Gap-B). A win32 agent
 * has no pane, so `messages.resolveSender` -- which reads TMUX_PANE -- can never
 * name it. `POST /api/report`'s resolver chain was already built for this
 * (`resolveAgentSender`, token first, pane second) and its token arm returns a
 * `paneless: true` card without touching a pane. What was missing was the other
 * half: nothing on Windows MINTED a token or handed one to the agent. On the Mac
 * that is `bin/agent-supervisor.sh`, which mints per launch and puts
 * KOSMOS_AGENT_TOKEN in the pane environment. Windows has no supervisor, so the
 * mint belongs at the same moment as the session-id mint -- here -- and for the
 * same reason: one place, so the recorded session and the token that speaks for
 * it cannot disagree.
 *
 * 🛑 THE TOKEN IS KEYED ON THE ROSTER NAME, and the supervisor's comment is the
 * warning worth repeating: "minting under the raw session name would key the file
 * where `resolve` never looks." On the Mac the two differ (the roster name is the
 * tmux session minus a `-discord` suffix), which is why that path derives one
 * from the other. Here they are the SAME STRING BY CONSTRUCTION: `meta.name` is
 * what win32sessions records, what win32roster emits as both session and claim,
 * and what `status.isNamedOurs` matches. So this mints on `meta.name` with no
 * derivation -- and that absence is the point, not an omission.
 *
 * ⚠️ A FAILED MINT DOES NOT FAIL THE LAUNCH, matching the supervisor's stated
 * rule ("a mint is never worth a failed launch") -- but the CONSEQUENCE differs
 * on this platform and the difference is why it is surfaced rather than
 * swallowed. On the Mac a tokenless agent still reports through the pane
 * fallback. Here there is no pane to fall back to, and on an enforcing board
 * `/api/report` sets `denyPaneFallback` and refuses outright. So a tokenless
 * win32 agent is CAPTURE-ONLY: win32capture still reads its live state out of
 * `claude agents --json`, and what it loses is the self-reported half --
 * needs_you and blocked, the two words that mean a person is the blocker.
 * Degraded in a specific, nameable way rather than silent, which is why the
 * caller is handed `tokenBecause` instead of a boolean.
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
const sendertoken = require('./sendertoken');

/**
 * Mint a session id, record it as Kosmos-owned, and return the launch args that
 * pin it. Call this immediately before spawning the interactive win32 agent.
 *
 * @param {{ name: string, runner?: string }} meta the Kosmos agent name (the
 *   claim the roster emits and status.isNamedOurs matches) and the runner
 *   ('claude' | 'codex'), the same vocabulary win32sessions.record and the roster
 *   already use -- no private words.
 * @returns {{ ok: true, sessionId: string, launchArgs: string[], name: string,
 *             env: object, token: string|null, instance: string|null,
 *             tokenBecause: string|null }
 *           | { ok: false, because: string }}
 *   On success, sessionId is the id to pass to the spawn (it is already in
 *   launchArgs) and launchArgs is ['--session-id', sessionId] to splice into the
 *   claude argv. `env` is the environment to MERGE into the spawn -- it carries
 *   KOSMOS_AGENT_TOKEN when a token was minted and is EMPTY when one was not, so
 *   a caller that spreads it unconditionally is correct either way and never
 *   spells the variable name itself. `token`/`instance` are the same mint,
 *   returned so the caller can hand the pair to abandon(); `tokenBecause` is null
 *   on success and carries the mint's own reason when reporting will be degraded.
 *   On failure (a name the record refuses -- blank or invisible --, or a store
 *   write fault) nothing was recorded and there is nothing to abandon; `because`
 *   is the record's own reason, spoken plainly.
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
  // The record accepted the name, so it passed validName and is the exact string
  // the roster will emit. Read it back from `meta` the same way record() did
  // rather than re-deriving it: one normalizer, and the token keys on the value
  // that actually landed.
  const name = meta && typeof meta.name === 'string' ? meta.name : '';
  /* ORDER MATTERS: record FIRST, mint SECOND. A mint whose record then failed
     would leave a live token for a session that was never filed -- a credential
     with no row behind it. This way every token that exists has a record, and the
     only asymmetry left (a record with no token) is the degraded-but-visible case
     the header describes, which the board can see and say. */
  let token = null;
  let instance = null;
  let tokenBecause = null;
  /* try/catch as well as the ok-check: mint reports a busy store or a write
     fault through `ok`, but this must not be the thing that throws a launch away
     -- the supervisor's rule, and the reason it swallows there too. */
  try {
    const m = sendertoken.mint(name);
    if (m && m.ok) { token = m.token; instance = m.instance; }
    else { tokenBecause = (m && m.because) || 'we could not mint a token for that agent'; }
  } catch (e) {
    tokenBecause = 'we could not mint a token for that agent' + ((e && e.code) ? ' (' + e.code + ')' : '');
  }
  // No re-validation of the token's shape here, deliberately. The supervisor
  // checks it is hex because it reads the value back off a SUBPROCESS's stdout,
  // where a stray warning could land in the variable. This call is in-process and
  // `mint` returns crypto.randomBytes(...).toString('hex') by construction, so a
  // check here would guard a hazard this path does not have.
  return {
    ok: true,
    sessionId,
    name,
    launchArgs: ['--session-id', sessionId],
    env: token ? { KOSMOS_AGENT_TOKEN: token } : {},
    token,
    instance,
    tokenBecause,
  };
}

/**
 * Undo a prepared session: drop its row from the record AND retire the token
 * minted for it. Call this when the spawn that would have started it never
 * started (the launch failed), and again when a session that DID run has ended
 * for good -- both mean the same thing to this module, that the prepared pair is
 * over and neither half should outlive it.
 *
 * Leaving the row is harmless to the roster -- it emits only sessions that are
 * BOTH recorded AND live in `claude agents --json`, and a session that never
 * started is never live -- but abandon() keeps the record honest and bounded,
 * matching create.js's own rollback discipline on a failed Mac start. Leaving the
 * TOKEN is not harmless in the same way: it is a live credential that can still
 * report as this agent, which is the rule `sendertoken.js:46` states outright --
 * whoever stops or deletes an agent MUST call the retire/revoke side, because
 * `mint` no longer rotates and a second mint no longer invalidates the first.
 *
 * 🔑 IT TAKES THE PREPARED OBJECT, NOT AN ID, and that is the whole safety of it.
 * Retiring the right credential needs the roster NAME and the INSTANCE, neither
 * of which is recoverable from a session id; a signature that took the id would
 * have to be handed them separately, which is a second place for the pair to
 * disagree -- the exact defect prepareSession's one-mint-point rule exists to
 * prevent. The caller always holds this object: it just called prepareSession and
 * needs launchArgs to spawn at all.
 *
 * ⚠️ RETIRE, NEVER REVOKE. `revoke` drops EVERY token for the agent; this run is
 * one of possibly several live runs of the same name, and killing the others'
 * credentials because this one failed to start would silence agents that are
 * working fine. `retire` removes exactly this instance (and unlinks the file when
 * it was the last one), which is the same distinction #1782 drew.
 *
 * BOTH HALVES ARE ALWAYS ATTEMPTED, even when the first fails: a store fault on
 * the record must not be what leaves a live credential behind. The returned
 * `because` names whichever half failed, record first.
 *
 * @param {{ sessionId: string, name?: string, instance?: string|null }} prepared
 *   the object a prior prepareSession returned.
 * @returns {{ ok: boolean, because?: string }} ok only when both halves are done.
 */
function abandon(prepared) {
  const sessionId = prepared && typeof prepared.sessionId === 'string' ? prepared.sessionId : '';
  const name = prepared && typeof prepared.name === 'string' ? prepared.name : '';
  const instance = prepared && typeof prepared.instance === 'string' ? prepared.instance : '';

  const forgot = win32sessions.forget(sessionId);

  /* No instance means no token was minted for this session (the degraded case the
     header describes), so there is nothing to retire and saying so would be
     inventing a failure. An instance with no name cannot be keyed, and that IS a
     failure worth naming rather than skipping quietly. */
  let retired = { ok: true };
  if (instance) {
    if (!name) {
      retired = { ok: false, because: 'we could not tell which agent that run belonged to, so its token is still live' };
    } else {
      try { retired = sendertoken.retire(name, instance); }
      catch (e) { retired = { ok: false, because: 'we could not retire that run' + ((e && e.code) ? ' (' + e.code + ')' : '') }; }
    }
  }

  if (!forgot.ok) return { ok: false, because: forgot.because };
  if (!retired.ok) return { ok: false, because: retired.because };
  return { ok: true };
}

module.exports = { prepareSession, abandon };
