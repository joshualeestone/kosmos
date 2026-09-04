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
  const zeroWidth = win32create.prepareSession({ name: '​' });
  assert.equal(zeroWidth.ok, false, 'an all-zero-width name is refused (validName, not .trim())');
  const missing = win32create.prepareSession({});
  assert.equal(missing.ok, false, 'a missing name is refused');
  assert.equal(Object.keys(win32sessions.read()).length, before,
    'a refused prepareSession recorded nothing -- no minted id leaked into the store');
});

test('#570 abandon() drops a prepared session from the record', () => {
  const out = win32create.prepareSession({ name: 'shortlived', runner: 'claude' });
  assert.equal(out.ok, true);
  assert.equal(win32sessions.isOurs(out.sessionId), true, 'recorded before abandon');
  const r = win32create.abandon(out.sessionId);
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
    { pid: 2, cwd: '/Users/agent1', kind: 'interactive', startedAt: 2, sessionId: crypto_uuid(), name: 'agent1-d2', status: 'busy' },
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

// A UUID for the test's "operator's own" fixture, independent of the module under
// test (do not reuse prepareSession -- that would record it, defeating the point).
function crypto_uuid() { return require('node:crypto').randomUUID(); }
