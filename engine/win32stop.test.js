'use strict';
/**
 * #570 (7b): ending a Windows agent's session -- the `tmux kill-session` analog.
 *
 * 🛑 WHAT THIS GUARDS IS A REPORT, NOT A KILL. The dangerous outcome here is not
 * "the kill failed"; it is a kill that failed being REPORTED as a removal, so the
 * board stops showing an agent that is still running and still writing. Every
 * assertion below is ultimately about which way an uncertain answer falls, and
 * they all fall the same way: unknown is not success.
 *
 * ⚠️ THE LOOK-AGAIN IS THE POINT. `taskkill` answering ok is not evidence the
 * process has gone, exactly as `kill-session`'s exit status is not on the Mac.
 * Both platforms had to learn this separately; the Mac learnt it in #2019.
 *
 *   node --test engine/win32stop.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// Sandbox the data root BEFORE the store is first read, so the ownership record
// this file writes to is never the operator's own.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32stop-570-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const win32stop = require('./win32stop');
const win32sessions = require('./win32sessions');

const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** A live-read reply keyed the way win32live returns it. */
function live(map) { return () => (map === null ? null : new Map(Object.entries(map))); }

/** Record taskkill argv instead of running it. */
function recordingKill(reply) {
  const calls = [];
  win32stop.setRunner((args) => { calls.push(args.join(' ')); return reply || { ok: true, out: '' }; });
  return calls;
}

function reset() { win32stop.setRunner(null); win32stop.setAlive(null); win32stop.setLive(null); win32stop.setPark(null); }
test.afterEach(reset);
test.after(reset);

test('#570 it kills the TREE by pid, and confirms the process is gone', () => {
  win32stop.setLive(live({ pigeonpete: { sessionId: SID, pid: 4242, status: 'busy' } }));
  const kills = recordingKill();
  win32stop.setAlive(() => false); // the look-again: gone

  const r = win32stop.end('pigeonpete');
  assert.equal(r.ok, true);
  assert.deepEqual(kills, ['/PID 4242 /T /F'],
    '/T because killing a parent on Windows leaves its children running -- ending a pane does not');
});

test('#570 THE LOOK-AGAIN: taskkill said ok, the process is still there, so this is NOT a success', () => {
  win32stop.setLive(live({ pigeonpete: { sessionId: SID, pid: 4242, status: 'busy' } }));
  recordingKill({ ok: true, out: 'SUCCESS: Sent termination signal' });
  win32stop.setAlive(() => true); // still alive despite a cheerful exit status

  const r = win32stop.end('pigeonpete');
  assert.equal(r.ok, false, 'the kill\'s own answer is not evidence -- this is what stops a removal over a live agent');
  assert.match(r.because, /still running/);
});

test('#570 a FAILED live read refuses: unknown is not "nothing was running"', () => {
  win32stop.setLive(live(null));
  const kills = recordingKill();

  const r = win32stop.end('pigeonpete');
  assert.equal(r.ok, false, 'we could not look, so we cannot say the session is gone');
  assert.match(r.because, /could not check/);
  assert.deepEqual(kills, [], 'and nothing was killed off a look that never happened');
});

test('#570 nothing owned under that name is the END STATE WE WANTED, not a failure', () => {
  win32stop.setLive(live({}));
  const kills = recordingKill();

  const r = win32stop.end('pigeonpete');
  assert.equal(r.ok, true, 'already gone is success -- the posture win32job.end and launchd exit 3 take');
  assert.equal(r.already, true);
  assert.deepEqual(kills, []);
});

test('#570 a live session with NO USABLE PID is an unknown, not a miss', () => {
  /* The false-zero one layer down: something owned IS running under this name and
     we have no way to end it. Answering "nothing to stop" would let the caller
     report the agent stopped. */
  win32stop.setLive(live({ pigeonpete: { sessionId: SID, pid: undefined, status: 'busy' } }));
  const kills = recordingKill();

  const r = win32stop.end('pigeonpete');
  assert.equal(r.ok, false);
  assert.match(r.because, /could not check/);
  assert.deepEqual(kills, [], 'and we do not shell a kill at "undefined"');
});

test('#570 taskkill 128 / "not found" reads as already gone, not as a failure', () => {
  win32stop.setLive(live({ pigeonpete: { sessionId: SID, pid: 4242, status: 'idle' } }));
  recordingKill({ ok: false, code: 128, out: 'ERROR: The process "4242" not found.' });
  win32stop.setAlive(() => false);

  assert.equal(win32stop.end('pigeonpete').ok, true,
    'the process died between the look and the kill -- the end state either way');
});

test('#570 a real kill failure is reported with what Windows said', () => {
  win32stop.setLive(live({ pigeonpete: { sessionId: SID, pid: 4242, status: 'idle' } }));
  recordingKill({ ok: false, code: 1, out: 'ERROR: Access is denied.\r\n' });
  win32stop.setAlive(() => true);

  const r = win32stop.end('pigeonpete');
  assert.equal(r.ok, false);
  assert.match(r.because, /Access is denied/, 'the operator gets the actual reason, not a generic one');
});

test('#570 a successful end FORGETS the session, so a restart cannot mint a duplicate name', () => {
  /* The record is a file; unlike the Mac's tmux option it does not die with the
     session. Restart ends one session and lets the supervisor start another under
     the SAME name -- so without this, two sessionIds carry one name and the join
     picks between them silently. */
  win32sessions.record(SID, { name: 'pigeonpete', runner: 'claude' });
  assert.equal(win32sessions.isOurs(SID), true, 'precondition: the record holds it');

  win32stop.setLive(live({ pigeonpete: { sessionId: SID, pid: 4242, status: 'busy' } }));
  recordingKill();
  win32stop.setAlive(() => false);

  assert.equal(win32stop.end('pigeonpete').ok, true);
  assert.equal(win32sessions.isOurs(SID), false,
    'the ownership claim must not outlive the process it described');
});

test('#570 a FAILED end leaves the record alone -- we did not end that session', () => {
  const other = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
  win32sessions.record(other, { name: 'raph', runner: 'claude' });

  win32stop.setLive(live({ raph: { sessionId: other, pid: 77, status: 'busy' } }));
  recordingKill();
  win32stop.setAlive(() => true); // it survived

  assert.equal(win32stop.end('raph').ok, false);
  assert.equal(win32sessions.isOurs(other), true,
    'forgetting a session that is still running would drop it off the board while it runs');
});

test('#570 the default look-again reads EPERM as ALIVE, not as gone', () => {
  /* The fail-closed direction, and the one that is easy to get backwards: a throw
     from process.kill is not "the process is gone" -- only ESRCH is. Asserted
     through the real default (no setAlive), by killing a pid nobody owns. */
  /* MEASURED on this box rather than assumed, because the pid to use is not the
     POSIX one. `process.kill(pid, 0)` under the bundled node on Windows 11:

         2      -> ESRCH   (no such process -- pid 2 is not a Windows pid)
         4      -> EPERM   (System: very much running, and not ours to signal)
         999999 -> ESRCH
         self   -> no throw

     So pid 4 is the un-signallable-but-alive case here; a test written around
     POSIX's pid 1/2 asserts nothing on Windows, and passed for the wrong reason. */
  win32stop.setLive(live({ ghost: { sessionId: SID, pid: 4, status: 'idle' } }));
  recordingKill();
  const r = win32stop.end('ghost');
  assert.equal(r.ok, false, 'an un-signallable process is still a running process');
  assert.match(r.because, /still running/);
});

/* ── endSession: the rollback's question is not the removal's ──────────────── */

test('#570 endSession WAITS for a session that has not registered yet', () => {
  /* The defect this exists for: a win32 agent takes ~5s to register, and a
     create rollback can run inside that window. A single look would see nothing,
     conclude there was nothing to stop, and walk away from a live agent. */
  let looks = 0;
  win32stop.setLive(() => {
    looks += 1;
    // Not there for the first two looks, then it registers.
    if (looks < 3) return new Map();
    return new Map([['pigeonpete', { sessionId: SID, pid: 4242, status: 'idle' }]]);
  });
  const kills = recordingKill();
  win32stop.setAlive(() => false);
  const napped = [];
  win32stop.setPark((ms) => napped.push(ms));

  const r = win32stop.endSession(SID, { waitMs: 5000, stepMs: 500 });
  assert.equal(r.ok, true, 'it waited, saw it appear, and ended it');
  assert.deepEqual(kills, ['/PID 4242 /T /F']);
  assert.equal(looks, 3, 'it kept looking rather than trusting the first empty answer');
  assert.deepEqual(napped, [500, 500], 'and it parked between looks instead of spinning');
});

test('#570 endSession that never sees the session reports FAILURE, not "already gone"', () => {
  /* ⚠️ The whole point. `end(name)` answers an OPEN question, so an empty look is
     a legitimate "nothing is running". This answers a CLOSED one -- we started
     this session -- so never seeing it is a thing we could not do, and the caller
     must be able to say so. */
  win32stop.setLive(() => new Map());
  const kills = recordingKill();
  win32stop.setPark(() => {});

  const r = win32stop.endSession(SID, { waitMs: 20, stepMs: 10 });
  assert.equal(r.ok, false, 'silence is not success here');
  assert.match(r.because, /never appeared/);
  assert.deepEqual(kills, [], 'and nothing was killed on a guess');
});

test('#570 endSession matches on the session ID, never on the name', () => {
  /* A rollback deletes the worker folder, so acting on the wrong session is
     unrecoverable. Two live agents, and only the id says which one we started. */
  const other = 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee';
  win32stop.setLive(() => new Map([
    ['someone-else', { sessionId: other, pid: 111, status: 'busy' }],
    ['ours', { sessionId: SID, pid: 222, status: 'idle' }],
  ]));
  const kills = recordingKill();
  win32stop.setAlive(() => false);

  assert.equal(win32stop.endSession(SID, { waitMs: 0 }).ok, true);
  assert.deepEqual(kills, ['/PID 222 /T /F'], 'it ended OUR session, not the one next to it');
});

test('#570 endSession forgets the record too, so no row outlives the deleted folder', () => {
  const sid = 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee';
  win32sessions.record(sid, { name: 'rolled-back', runner: 'claude' });
  win32stop.setLive(() => new Map([['rolled-back', { sessionId: sid, pid: 4242, status: 'idle' }]]));
  recordingKill();
  win32stop.setAlive(() => false);

  assert.equal(win32stop.endSession(sid, { waitMs: 0 }).ok, true);
  assert.equal(win32sessions.isOurs(sid), false,
    'a rollback that left the record would leave a board row for a folder it deleted');
});
