'use strict';
/**
 * #570: removal, restore and restart reach a Scheduled Task on Windows.
 *
 * 🛑 WHY THIS FILE EXISTS SEPARATELY FROM remove.test.js. That suite builds real
 * agents through fixtures that are launchd- and tmux-shaped, so on a Windows box
 * it is red before this change and red after it (50 failures at the parent
 * commit, 48 with this one -- measured, not assumed). Porting those fixtures is a
 * much larger piece of work than the branch under test, and gating the branch on
 * it would mean shipping the branch untested. So this asserts the DISPATCH -- the
 * seam where the platforms differ -- directly, on both platforms, from either.
 *
 * 🔑 THE LOAD-BEARING NEGATIVE IS "NO launchctl", and the bug it guards was quiet
 * rather than loud. Before this change `remove.js` had no win32 arm: `jobFor`
 * decided whether an agent had a startup job by stat-ing a `.plist`, none exists
 * on Windows, so it answered null and the entire job block was SKIPPED. The
 * removal reported success and told the person "nothing will start it again on
 * its own" -- while the Scheduled Task stayed registered and enabled, and brought
 * the agent back at the next logon.
 *
 * ⚠️ AND THE MIRROR OF THIS LANE'S WHOLE PROBLEM SHOWS UP IN THE LAST ARM. A Mac
 * cannot exercise the win32 branch, which is why every defect here survived; a
 * Windows box cannot exercise the darwin branch either, because `process.getuid`
 * does not exist on win32. The control arm stubs it rather than skipping, so the
 * two-sided guard holds on both platforms instead of only where it is convenient.
 *
 *   node --test engine/remove.win32-job-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const remove = require('./remove');
const job = require('./win32job');

test.after(() => { job.setRunner(null); remove.setRunner(null); });

/** Record schtasks argument vectors instead of running them. */
function recordingTasks(reply) {
  const calls = [];
  job.setRunner((args) => { calls.push(args.join(' ')); return reply || { ok: true, out: '' }; });
  return calls;
}

/** Record anything the module tries to shell on the Mac path. */
function recordingShell() {
  const ran = [];
  remove.setRunner((bin, args) => { ran.push(bin + ' ' + (args || []).join(' ')); return { ok: true }; });
  return ran;
}

test('#570 a STOP disables the task and ends the running one -- never launchctl', () => {
  const tasks = recordingTasks();
  const shelled = recordingShell();
  const ops = remove.jobOps('win32');

  assert.equal(ops.disable('winagent-1'), true);
  assert.equal(ops.stopNow('winagent-1'), true);

  assert.deepEqual(shelled.filter((c) => /launchctl/.test(c)), [],
    'no launchctl on Windows -- it is absent, and getuid() is undefined here');
  assert.match(tasks[0], /\/Change .*\/DISABLE/, 'the persisted half: it must not start at the next logon');
  assert.match(tasks[1], /\/End/, 'the running half: the supervisor from the LAST logon is still looping');
});

test('#570 DISABLE COMES FIRST, because the window between the two is a real one', () => {
  /* remove.js already documents this for the Mac: stopped-but-still-enabled is a
     state a login can undo. Windows has that window and a wider one besides --
     disabling a task does nothing to a supervisor already running, so the order
     is what makes "stopped" mean stopped. */
  const tasks = recordingTasks();
  const ops = remove.jobOps('win32');
  ops.disable('winagent-1');
  ops.stopNow('winagent-1');

  const disabledAt = tasks.findIndex((c) => /\/DISABLE/.test(c));
  const endedAt = tasks.findIndex((c) => /\/End/.test(c));
  assert.ok(disabledAt >= 0 && endedAt >= 0, 'both acts ran: ' + JSON.stringify(tasks));
  assert.ok(disabledAt < endedAt, 'disable must precede the stop: ' + JSON.stringify(tasks));
});

test('#570 a RESTORE is the exact inverse: enable, then run it now', () => {
  const tasks = recordingTasks();
  const shelled = recordingShell();
  const ops = remove.jobOps('win32');

  assert.equal(ops.enable('winagent-1'), true);
  assert.equal(ops.startNow('winagent-1'), true);

  assert.deepEqual(shelled.filter((c) => /launchctl/.test(c)), [], 'no launchctl on Windows');
  assert.match(tasks[0], /\/Change .*\/ENABLE/);
  assert.match(tasks[1], /\/Run/, 'enable alone would leave it off until the person next signed in');
});

test('#570 "is there still something that would start it" is asked of the TASK, not a plist', () => {
  /* 🛑 The defect this replaces. `record.plist` is null on win32 because there is
     no plist, so the Mac's expression `!record.plist || !existsSync(...)` was
     TRUE for every Windows restore -- producing "the file that starts it is no
     longer on this computer" about an agent whose task was registered and fine. */
  recordingTasks({ ok: true, out: 'TaskName: Kosmos\\agent-winagent-1\nStatus: Ready' });
  const present = remove.jobOps('win32');
  assert.equal(present.startableGone('winagent-1', { label: 'Kosmos\\agent-winagent-1', plist: null }), false,
    'a registered task means there IS something that starts it');

  recordingTasks({ ok: false, out: 'ERROR: The system cannot find the file specified.' });
  const absent = remove.jobOps('win32');
  assert.equal(absent.startableGone('winagent-1', { label: 'Kosmos\\agent-winagent-1', plist: null }), true,
    'and an unregistered one means there is not');
});

test('#570 jobFor finds a win32 agent through its REGISTRATION, not a file on disk', () => {
  recordingTasks({ ok: true, out: 'TaskName: Kosmos\\agent-winagent-1\nStatus: Ready' });
  const found = remove.jobFor('winagent-1', 'win32');
  assert.ok(found, 'a registered task is a job we own');
  assert.equal(found.label, 'Kosmos\\agent-winagent-1');
  assert.equal(found.plist, null, 'and it must not invent a plist path on a platform that has none');

  recordingTasks({ ok: false, out: 'ERROR: The system cannot find the file specified.' });
  assert.equal(remove.jobFor('winagent-1', 'win32'), null);
});

test('#570 the darwin dispatch is untouched -- it still speaks launchctl', () => {
  /* The other half of the two-sided control. A win32 branch that quietly changed
     the Mac's behaviour would be a far worse regression than the bug it fixed,
     and every arm above would still pass. */
  const tasks = recordingTasks();
  const shelled = recordingShell();
  const ops = remove.jobOps('darwin');

  /* The darwin arm builds a `gui/<uid>/...` label, and `process.getuid` is not a
     function on win32 -- so running this suite on the very platform the change is
     for would otherwise be unable to check that the Mac still works. Stub and
     restore rather than skip: a control arm that vanishes on half the fleet is
     the shape this lane keeps paying for. */
  const hadUid = typeof process.getuid === 'function';
  if (!hadUid) process.getuid = () => 501;
  try {
    ops.disable('macagent', { label: 'com.kosmos.macagent', plist: '/tmp/x.plist' });
    ops.stopNow('macagent', { label: 'com.kosmos.macagent', plist: '/tmp/x.plist' });
  } finally {
    if (!hadUid) delete process.getuid;
  }

  assert.deepEqual(tasks, [], 'no schtasks on the Mac');
  assert.equal(shelled.length, 2);
  assert.match(shelled[0], /launchctl disable/);
  assert.match(shelled[1], /launchctl bootout/);
});

/* ── 7b: ending the AGENT, not the job ───────────────────────────────────────
 *
 * 🛑 THE GAP THESE COVER IS THE ONE R6 FOUND ON A REAL BOX. The job-level acts
 * above all passed while a Windows removal still failed, because ending the agent
 * itself was a separate, un-ported step:
 *
 *     it was not set to start on its own, so there was nothing to turn off  ok
 *     closed its window                                                     FAILED
 *
 * `removeInner` and `restartInner` each carried their own copy of the tmux kill,
 * so the port had to reach both -- which is why `sessionOps` is one dispatch and
 * why these assert it rather than either call site's wiring alone.
 */
const stop = require('./win32stop');

test('#570 7b a win32 END kills the agent process -- never tmux', () => {
  const shelled = recordingShell();
  const kills = [];
  stop.setLive(() => new Map([['winagent-1', { sessionId: 'a-b-c-d-e', pid: 4242, status: 'busy' }]]));
  stop.setRunner((args) => { kills.push(args.join(' ')); return { ok: true, out: '' }; });
  stop.setAlive(() => false);

  assert.equal(remove.sessionOps('win32').end('winagent-1'), true);

  assert.deepEqual(shelled.filter((c) => /tmux/.test(c)), [],
    'no tmux on Windows -- an agent here is a hidden console, not a pane');
  assert.deepEqual(kills, ['/PID 4242 /T /F']);
  stop.setLive(null); stop.setRunner(null); stop.setAlive(null);
});

test('#570 7b a win32 END that cannot confirm the process is gone reports FALSE', () => {
  /* The whole reason `end` returns a boolean rather than "we asked": both call
     sites turn a false into a PARTIAL that says the agent is still going. An arm
     that reported the kill's own exit status would report a removal over it. */
  recordingShell();
  stop.setLive(() => new Map([['winagent-1', { sessionId: 'a-b-c-d-e', pid: 4242, status: 'busy' }]]));
  stop.setRunner(() => ({ ok: true, out: 'SUCCESS: Sent termination signal' }));
  stop.setAlive(() => true);

  assert.equal(remove.sessionOps('win32').end('winagent-1'), false,
    'taskkill said SUCCESS and the process is still there -- that is not a stopped agent');
  stop.setLive(null); stop.setRunner(null); stop.setAlive(null);
});

test('#570 7b the darwin dispatch is untouched: kill-session, then LOOK AGAIN', () => {
  const shelled = [];
  remove.setRunner((bin, args) => {
    shelled.push(bin + ' ' + (args || []).join(' '));
    // has-session answering 1 is tmux for "it is gone", which is the success we want.
    return /has-session/.test((args || []).join(' ')) ? { ok: false, code: 1 } : { ok: true };
  });

  assert.equal(remove.sessionOps('darwin', '/opt/homebrew/bin/tmux').end('casey'), true);
  assert.deepEqual(shelled, [
    '/opt/homebrew/bin/tmux kill-session -t =casey',
    '/opt/homebrew/bin/tmux has-session -t =casey',
  ], '=-anchored, and the look-again is not optional');
});

test('#570 7b BOTH platforms refuse to call a still-live session stopped', () => {
  // darwin: has-session says the session is STILL THERE (exit 0).
  remove.setRunner(() => ({ ok: true }));
  assert.equal(remove.sessionOps('darwin', '/opt/homebrew/bin/tmux').end('casey'), false,
    'the Mac arm: a kill that reported ok over a session that is still listed');

  // win32: the pid is still signallable.
  stop.setLive(() => new Map([['casey', { sessionId: 'a-b-c-d-e', pid: 4242, status: 'busy' }]]));
  stop.setRunner(() => ({ ok: true, out: '' }));
  stop.setAlive(() => true);
  assert.equal(remove.sessionOps('win32').end('casey'), false,
    'the Windows arm: same rule, different substrate');
  stop.setLive(null); stop.setRunner(null); stop.setAlive(null);
});
