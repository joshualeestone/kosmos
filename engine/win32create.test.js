'use strict';
/**
 * #570: the win32 create-side record-write. prepareSession mints a session id,
 * records it as Kosmos-owned, and returns the launch args that pin that id. These
 * tests drive it through the REAL win32sessions store (a sandbox data root), and
 * the strongest one runs a prepared session end-to-end through the REAL
 * win32roster + status.js: what create WRITES must be exactly what the board
 * READS, or a live session would be invisible.
 *
 *   node --test engine/win32create.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const crypto = require('node:crypto');

// A sandbox data root BEFORE requiring anything that reads the store, so these
// tests never touch the real ownership record.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32create-570-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const win32create = require('./win32create');
const win32sessions = require('./win32sessions');
const win32roster = require('./win32roster');
const status = require('./status');

test('#570 prepareSession records the session and pins the SAME id in launchArgs (one mint point)', () => {
  const out = win32create.prepareSession({ name: 'raph-9a', runner: 'claude' });
  assert.equal(out.ok, true, 'a valid name is accepted');
  // The record now maps THIS id -> the name/runner we asked for.
  const rec = win32sessions.read();
  assert.ok(Object.prototype.hasOwnProperty.call(rec, out.sessionId),
    'the returned sessionId is an own-key of the record');
  assert.equal(rec[out.sessionId].name, 'raph-9a', 'the recorded name is the one asked for');
  assert.equal(rec[out.sessionId].runner, 'claude', 'the recorded runner is the one asked for');
  // launchArgs carry EXACTLY the recorded id -- the property that stops the
  // board recording one session while claude runs another.
  assert.deepEqual(out.launchArgs, ['--session-id', out.sessionId],
    'launchArgs pin the recorded id verbatim');
  assert.equal(win32sessions.isOurs(out.sessionId), true, 'the record calls it ours');
});

test('#570 the minted id is a shape claude --session-id accepts AND win32sessions.validId passes', () => {
  const out = win32create.prepareSession({ name: 'angel-8a', runner: 'claude' });
  assert.equal(out.ok, true);
  // Canonical v4 UUID (8-4-4-4-12 hex), which is what the flag accepts (measured)
  // and what the roster re-validates the live id against.
  assert.match(out.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'a canonical v4 UUID');
  assert.equal(win32sessions.validId(out.sessionId), true,
    'the minted id passes the same gate the roster re-checks the live id against');
});

test('#570 two prepareSession calls mint DISTINCT ids (no reuse)', () => {
  const a = win32create.prepareSession({ name: 'mona-1', runner: 'claude' });
  const b = win32create.prepareSession({ name: 'mona-2', runner: 'claude' });
  assert.notEqual(a.sessionId, b.sessionId, 'each session gets its own id');
});

test('#570 a runner defaults to empty string when omitted (never undefined in the record)', () => {
  const out = win32create.prepareSession({ name: 'no-runner' });
  assert.equal(out.ok, true);
  assert.equal(win32sessions.read()[out.sessionId].runner, '',
    'an omitted runner records as "" -- the shape the roster flattens, not undefined');
});

test('#570 a blank/invisible name is REFUSED and writes NOTHING (fail-closed at the door)', () => {
  const before = Object.keys(win32sessions.read()).length;
  const blank = win32create.prepareSession({ name: '   ' });
  assert.equal(blank.ok, false, 'a whitespace-only name is refused');
  assert.ok(typeof blank.because === 'string' && blank.because.length > 0,
    'the refusal says why, in the record\'s own words');
  // A failure carries NO id and NO args: the spawn must have nothing to launch
  // with, or a caller that ignored `ok` could start a session under a leaked id
  // that was never recorded (unrecorded -> invisible on the board).
  assert.equal(blank.sessionId, undefined, 'no sessionId on a refusal');
  assert.equal(blank.launchArgs, undefined, 'no launchArgs on a refusal');
  const zeroWidth = win32create.prepareSession({ name: '​' });
  assert.equal(zeroWidth.ok, false, 'an all-zero-width name is refused (validName, not .trim())');
  const missing = win32create.prepareSession({});
  assert.equal(missing.ok, false, 'a missing name is refused');
  assert.equal(Object.keys(win32sessions.read()).length, before,
    'a refused prepareSession recorded nothing -- no minted id leaked into the store');
});

test('#570 a store WRITE FAULT (not a bad name) is surfaced verbatim, with no leak and nothing recorded', () => {
  // The refusals above exercise the !r.ok branch via a name record() rejects. A
  // write fault reaches the SAME branch for a different reason -- point the live
  // store root (win32sessions derives it through a getter, honoured live) at a
  // regular FILE, so record()'s mkdirSync throws ENOTDIR and it returns
  // ok:false with a store-write `because`, not a name one.
  const saved = process.env.AGENT_WORKFORCE_DATA;
  const blocker = nodePath.join(SANDBOX, 'root-is-a-file');
  fs.writeFileSync(blocker, 'x');
  process.env.AGENT_WORKFORCE_DATA = blocker;
  try {
    const before = Object.keys(win32sessions.read()).length; // read of a file-root -> {} -> 0
    const out = win32create.prepareSession({ name: 'writefault', runner: 'claude' });
    assert.equal(out.ok, false, 'a store write fault is surfaced, not swallowed as ok');
    assert.ok(typeof out.because === 'string' && out.because.length > 0, 'the write fault says why');
    assert.ok(!/session id we can key/.test(out.because),
      'the reason is a WRITE fault, not the name/id gate (proves a non-name path through !r.ok)');
    assert.equal(out.sessionId, undefined, 'no sessionId leaks on a write fault');
    assert.equal(out.launchArgs, undefined, 'no launchArgs leak on a write fault');
    assert.equal(Object.keys(win32sessions.read()).length, before, 'nothing recorded on a write fault');
  } finally {
    process.env.AGENT_WORKFORCE_DATA = saved;
  }
});

test('#570 abandon() drops a prepared session from the record', () => {
  const out = win32create.prepareSession({ name: 'shortlived', runner: 'claude' });
  assert.equal(out.ok, true);
  assert.equal(win32sessions.isOurs(out.sessionId), true, 'recorded before abandon');
  // It takes the PREPARED OBJECT, not the id: retiring the right token needs the
  // name and instance, and neither is recoverable from a session id.
  const r = win32create.abandon(out);
  assert.equal(r.ok, true, 'abandon reports ok');
  assert.equal(win32sessions.isOurs(out.sessionId), false, 'the session is no longer ours after abandon');
});

test('#570 END TO END: a prepared session that goes live is emitted by the REAL roster as ours', () => {
  // create side: prepare (mint + record).
  const out = win32create.prepareSession({ name: 'endtoend-7', runner: 'claude' });
  assert.equal(out.ok, true);
  // read side: the session is now live in `claude agents --json` under the id we
  // pinned (the interactive spawn would have carried out.sessionId via launchArgs
  // -- measured that the id round-trips). Feed the REAL win32roster the real
  // record (no injected map) and a live agents list carrying that id.
  const liveAgents = [
    { pid: 1, cwd: '/w/e', kind: 'interactive', startedAt: 1, sessionId: out.sessionId, name: 'endtoend-cwdname', status: 'idle' },
    // an UNRECORDED session (the operator's own) must stay invisible.
    { pid: 2, cwd: '/Users/agent1', kind: 'interactive', startedAt: 2, sessionId: crypto.randomUUID(), name: 'agent1-d2', status: 'busy' },
  ];
  const src = win32roster.make({ run: () => liveAgents });   // real record, real store
  const panes = status.parsePanes(src());
  const ours = panes.filter((p) => status.isNamedOurs(p));
  assert.equal(ours.length, 1, 'exactly the prepared session is ours');
  // The roster PREFERS the recorded name over the live cwd-derived name -- which
  // is why the record is load-bearing: claude names the session from its cwd
  // ("endtoend-cwdname"), not the Kosmos name.
  assert.equal(ours[0].session, 'endtoend-7', 'the emitted name is the RECORDED name, not the live cwd name');
  assert.equal(ours[0].claim, 'endtoend-7', 'the claim equals the recorded name so isNamedOurs matches');
  assert.equal(status.isAgentSession(ours[0]), true, 'it classifies as a real agent (typeable/restartable)');
});
// The "operator's own" fixture above mints its id straight from crypto.randomUUID
// (imported at module scope), NOT via prepareSession -- calling prepareSession
// would RECORD it, defeating the point of an UNRECORDED session.

/* ---------------------------------------------------------------------------
 * #570 Gap-B: the SENDER TOKEN half.
 *
 * The route that records a report (`POST /api/report` -> `resolveAgentSender`)
 * was already built for a paneless caller: token first, pane second, and its
 * token arm returns a card without reading TMUX_PANE. What was missing was the
 * other half -- nothing on Windows minted a token or handed one to the agent.
 * These drive the mint through the REAL sendertoken store, and the strongest one
 * resolves a prepared session's token through the SAME two arms the route uses.
 * ------------------------------------------------------------------------- */
const sendertoken = require('./sendertoken');
const store = require('./store');

test('#570 Gap-B prepareSession mints a sender token and hands it out as spawn env', () => {
  const out = win32create.prepareSession({ name: 'tok-1', runner: 'claude' });
  assert.equal(out.ok, true);
  assert.equal(typeof out.token, 'string', 'a token was minted');
  assert.match(out.token, /^[0-9a-f]+$/, 'the token is hex by construction (no re-validation needed in-process)');
  assert.equal(typeof out.instance, 'string', 'the run is identified, so exactly this run can be retired later');
  assert.equal(out.tokenBecause, null, 'nothing to explain when the mint succeeded');
  // The caller never spells the variable name: it merges `env` verbatim.
  assert.deepEqual(out.env, { KOSMOS_AGENT_TOKEN: out.token },
    'env carries the token under the name install/kosmos reads it back from');
  assert.equal(out.name, 'tok-1', 'the roster name comes back, because abandon needs it to key the retire');
});

test('#570 Gap-B the minted token RESOLVES to the agent with no pane anywhere (the arm win32 lands on)', () => {
  const out = win32create.prepareSession({ name: 'tok-paneless', runner: 'claude' });
  assert.equal(out.ok, true);
  // server.js:502 -- resolveName is the arm that does not consult a pane roster,
  // and it is the one a win32 agent reaches. The key is the safeKey'd ROSTER
  // name, which on win32 is meta.name with no derivation.
  const byName = sendertoken.resolveName(out.token);
  assert.equal(byName.ok, true, 'the token resolves without a roster, so no pane is needed to be identified');
  assert.equal(byName.key, store.safeKey('tok-paneless'),
    'it keys on the ROSTER name -- minting under anything else files it where resolve never looks');
  assert.equal(byName.instance, out.instance, 'and it names the run that minted it');
});

test('#570 Gap-B END TO END: one prepared session is BOTH emitted by the real roster AND resolvable by its token', () => {
  const out = win32create.prepareSession({ name: 'gapb-e2e', runner: 'claude' });
  assert.equal(out.ok, true);
  // The session goes live under the pinned id, exactly as the roster end-to-end
  // test above establishes.
  const liveAgents = [
    { pid: 11, cwd: '/w/e', kind: 'interactive', startedAt: 1, sessionId: out.sessionId, name: 'gapb-cwdname', status: 'idle' },
  ];
  const panes = status.parsePanes(win32roster.make({ run: () => liveAgents })());
  const ours = panes.filter((p) => status.isNamedOurs(p));
  assert.equal(ours.length, 1, 'the prepared session is on the board');
  // Now the OTHER arm: build the roster in the shape server.js hands `resolve`
  // (sessionName + isNamedOurs, from the REAL classifier) and resolve the token
  // the spawn would have carried. Both halves must land on the same agent, or
  // the board shows a session whose reports it cannot attribute.
  const roster = ours.map((p) => ({ sessionName: p.session, isNamedOurs: status.isNamedOurs(p) }));
  const carded = sendertoken.resolve(out.token, roster);
  assert.equal(carded.ok, true, 'the token resolves against the roster the board actually builds');
  assert.equal(carded.card.sessionName, ours[0].session,
    'the token speaks for the SAME agent the roster emits -- record and credential agree');
  assert.equal(carded.instance, out.instance);
});

test('#570 Gap-B abandon() retires the token too: the credential dies with the record', () => {
  const out = win32create.prepareSession({ name: 'tok-abandon', runner: 'claude' });
  assert.equal(out.ok, true);
  assert.equal(sendertoken.resolveName(out.token).ok, true, 'live before abandon');
  const r = win32create.abandon(out);
  assert.equal(r.ok, true, 'abandon reports ok');
  assert.equal(win32sessions.isOurs(out.sessionId), false, 'the record is gone');
  // sendertoken.js:46 -- mint no longer rotates, so a token outlives its session
  // unless someone retires it. Leaving it is a live credential for a session that
  // will never run.
  assert.equal(sendertoken.resolveName(out.token).ok, false,
    'the token no longer resolves -- it did not outlive the session it was minted for');
});

test('#570 Gap-B abandon() retires ONLY this run, leaving the other live run speaking', () => {
  // Two launches of ONE agent -- the case sendertoken exists to make visible.
  const first = win32create.prepareSession({ name: 'twolaunch', runner: 'claude' });
  const second = win32create.prepareSession({ name: 'twolaunch', runner: 'claude' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.instance, second.instance, 'two launches are two runs');
  const r = win32create.abandon(first);
  assert.equal(r.ok, true);
  // RETIRE, never REVOKE. revoke() drops every token for the name, which would
  // silence a run that is working fine because a different one failed to start.
  assert.equal(sendertoken.resolveName(first.token).ok, false, 'the abandoned run is cut off');
  assert.equal(sendertoken.resolveName(second.token).ok, true,
    'the OTHER live run still speaks -- abandoning one launch is not revoking the agent');
});

test('#570 Gap-B a token-store fault DEGRADES the session, it does not fail the launch', () => {
  /* The Mac supervisor rule is "a mint is never worth a failed launch", and this
     keeps it -- but the consequence differs here (no pane to fall back to), so
     the reason is SURFACED rather than swallowed.

     The fault is scoped to ONE agent token file: sendertoken DIR is captured
     from store.ROOT at require time, so it cannot be redirected live the way the
     win32sessions getter can. Putting a DIRECTORY where that agent .json belongs
     makes the write fail for this name and no other.

     🛑 THE PATH COMES FROM THE MODULE (sendertoken.DIR), NOT REBUILT HERE. The
     first version of this test joined SANDBOX + 'data' + 'sendertokens' by hand
     and blocked a path nothing writes to -- store.ROOT appends an
     'AgentWorkforce' segment -- so the mint SUCCEEDED and the test asserted a
     degradation that had not happened. A rebuilt path is a second copy of a fact
     the module already owns, and this is what that costs. */
  const name = 'mintfault';
  const blocked = nodePath.join(sendertoken.DIR, store.safeKey(name) + '.json');
  fs.mkdirSync(blocked, { recursive: true });
  const out = win32create.prepareSession({ name, runner: 'claude' });
  assert.equal(out.ok, true, 'the session still prepares -- a mint fault is not a failed launch');
  assert.equal(win32sessions.isOurs(out.sessionId), true, 'and it IS recorded, so the board can still see it');
  assert.equal(out.token, null, 'no token was minted');
  assert.deepEqual(out.env, {}, 'env is EMPTY rather than carrying an undefined -- a caller can spread it blind');
  assert.ok(typeof out.tokenBecause === 'string' && out.tokenBecause.length > 0,
    'the degradation is named: this agent will be capture-only, with no needs_you/blocked of its own');
  // And abandon still works on it: no instance means nothing to retire, which is
  // not a failure to report.
  const r = win32create.abandon(out);
  assert.equal(r.ok, true, 'abandoning a tokenless prepare is clean, not a phantom retire failure');
});
