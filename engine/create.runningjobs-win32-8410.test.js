'use strict';
/**
 * kosmos#8410 item 2, the Windows half of #668: an agent whose supervisor is up while the board can see no session
 * for it is "running, unseen" (the could-not-check pill), never a confident "Not running".
 *
 * create.runningJobs() is the list server.js reads for that (jobRunningUnseen). On Windows it used to fall into the
 * Mac arm and run /bin/launchctl, which Windows does not have, so the list was always empty and every such agent read
 * "Not running". Its Windows arm now reads the supervisor's own state file (win32streamstate.liveNames): an agent is
 * running when that file names a live pid. These pin it with a control where the task is parked (no state file) and one
 * where the supervisor has died (its file left behind, naming a dead pid), and the card label each row then wears.
 *
 *   node -r ./tools/no-schtasks-preload.cjs --test engine/create.runningjobs-win32-8410.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// A sandbox data root BEFORE requiring anything that reads the store.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'runningjobs-win32-8410-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const store = require('./store');
const create = require('./create');
const ss = require('./win32streamstate');
const cardlabel = require('./cardlabel');

const DIR = () => nodePath.join(store.ROOT, 'win32-state');
function supervisorFile(name, pid, extra) {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(nodePath.join(DIR(), `${name}.json`),
    JSON.stringify({ v: ss.STATE_FILE_VERSION, state: 'idle', sessionId: `s-${name}`, pid, at: new Date().toISOString(), ...extra }));
}
function clear() { fs.rmSync(DIR(), { recursive: true, force: true }); }
/* The board's offline row for an agent it cannot see, as server.js builds it (#668): running false, and
   jobRunningUnseen when its job holds a live process. */
const rowFor = (name, running) => ({ sessionName: name, running: false, jobRunningUnseen: running.has(name) });

test('kosmos#8410: a Windows agent whose supervisor is up is running, and its unseen row reads could-not-check, not Not running', () => {
  clear();
  supervisorFile('ghost', 4242);
  const alive = (pid) => pid === 4242;
  const running = create.runningJobs('win32', { isAlive: alive });
  assert.ok(running.has('ghost'), 'the supervisor is up (its state file names a live pid), yet the job does not read as running');
  assert.equal(cardlabel.labelOf(rowFor('ghost', running)), cardlabel.STATE_COPY.unknown, 'the unseen row claims Not running about a running supervisor');
});

test('kosmos#8410 control: a parked task (no supervisor state at all) keeps the plain Not running', () => {
  clear();
  supervisorFile('other', 4242);   // another agent is up, so an empty answer is not why this one reads Not running
  const running = create.runningJobs('win32', { isAlive: () => true });
  assert.ok(running.has('other'), 'CONTROL: the look itself works');
  assert.equal(running.has('ghost'), false);
  assert.equal(cardlabel.labelOf(rowFor('ghost', running)), 'Not running');
});

test('kosmos#8410: a supervisor that died leaves its file naming a dead pid, and that is not running', () => {
  clear();
  supervisorFile('ghost', 4242);
  supervisorFile('alive', 5151);
  const running = create.runningJobs('win32', { isAlive: (pid) => pid === 5151 });
  assert.equal(running.has('ghost'), false, 'a dead supervisor\'s leftover file read as running');
  assert.ok(running.has('alive'), 'CONTROL: a live one in the same folder still reads as running');
});

test('kosmos#8410: a state file this version cannot read, or not a state file, is not running; a missing folder is an empty answer', () => {
  clear();
  supervisorFile('oldv', 4242, { v: ss.STATE_FILE_VERSION + 1 });
  fs.writeFileSync(nodePath.join(DIR(), 'notes.txt'), '{"v":1,"pid":4242,"sessionId":"x"}');
  fs.writeFileSync(nodePath.join(DIR(), 'broken.json'), '{ not json');
  supervisorFile('good', 4242);
  const running = create.runningJobs('win32', { isAlive: () => true });
  assert.deepEqual([...running].sort(), ['good'], 'only the readable state file of a live supervisor counts');
  clear();
  assert.deepEqual([...create.runningJobs('win32', { isAlive: () => true })], [], 'no state folder at all is nobody running');
});

test('kosmos#8410: the Windows arm never runs launchctl (it does not exist on Windows); the Mac arm still does (control)', () => {
  clear();
  supervisorFile('ghost', 4242);
  const calls = [];
  create.setRunner((file, args) => { calls.push(String(file)); return { ok: true, stdout: '4242\t0\tcom.kosmos.agent.ghost\n' }; });
  try {
    create.runningJobs('win32', { isAlive: () => true });
    assert.deepEqual(calls.filter((f) => /launchctl/.test(f)), [], 'the Windows arm asked launchctl');
    create.runningJobs('darwin');
    assert.ok(calls.some((f) => /launchctl$/.test(f)), 'CONTROL: the Mac arm asks launchctl through the same runner');
  } finally { create.setRunner(null); }
});
