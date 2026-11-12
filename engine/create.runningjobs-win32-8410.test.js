'use strict';
/**
 * kosmos#8410 item 2, the Windows half of #668: an agent whose process is up while the board can see no session for
 * it is "running, unseen" (the could-not-check pill), never a confident "Not running".
 *
 * create.runningJobs() is the list server.js reads for that (jobRunningUnseen). On Windows it used to fall into the
 * Mac arm and run /bin/launchctl, which Windows does not have, so the list was always empty and every such agent read
 * "Not running". Its Windows arm now reads the state file the supervisor keeps of the agent's process
 * (win32streamstate.liveNames): an agent is running when that file names a live pid. (A Claude supervisor that is up
 * BETWEEN children is not covered: kosmos#8415.) These pin it with a control where the task is parked (no state file) and one
 * where the agent's process has died (its file left behind, naming a dead pid), and the card label each row then wears.
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
function agentProcessFile(name, pid, extra) {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(nodePath.join(DIR(), `${name}.json`),
    JSON.stringify({ v: ss.STATE_FILE_VERSION, state: 'idle', sessionId: `s-${name}`, pid, at: new Date().toISOString(), ...extra }));
}
function clear() { fs.rmSync(DIR(), { recursive: true, force: true }); }
/* The board's offline row for an agent it cannot see, as server.js builds it (#668): running false, and
   jobRunningUnseen when its job holds a live process. */
const rowFor = (name, running) => ({ sessionName: name, running: false, jobRunningUnseen: running.has(name) });

test('kosmos#8410: a Windows agent whose process is up is running, and its unseen row reads could-not-check, not Not running', () => {
  clear();
  agentProcessFile('ghost', 4242);
  const alive = (pid) => pid === 4242;
  const running = create.runningJobs('win32', { isAlive: alive });
  assert.ok(running.has('ghost'), 'the agent\'s process is up (its state file names a live pid), yet the job does not read as running');
  assert.equal(cardlabel.labelOf(rowFor('ghost', running)), cardlabel.STATE_COPY.unknown, 'the unseen row claims Not running about a running agent process');
});

test('kosmos#8410 control: a parked task (no state file at all) keeps the plain Not running', () => {
  clear();
  agentProcessFile('other', 4242);   // another agent is up, so an empty answer is not why this one reads Not running
  const running = create.runningJobs('win32', { isAlive: () => true });
  assert.ok(running.has('other'), 'CONTROL: the look itself works');
  assert.equal(running.has('ghost'), false);
  assert.equal(cardlabel.labelOf(rowFor('ghost', running)), 'Not running');
});

test('kosmos#8410: an agent process that died leaves its file naming a dead pid, and that is not running', () => {
  clear();
  agentProcessFile('ghost', 4242);
  agentProcessFile('alive', 5151);
  const running = create.runningJobs('win32', { isAlive: (pid) => pid === 5151 });
  assert.equal(running.has('ghost'), false, 'a dead process\'s leftover file read as running');
  assert.ok(running.has('alive'), 'CONTROL: a live one in the same folder still reads as running');
});

test('kosmos#8410: a state file this version cannot read, or not a state file, is not running; a missing folder is an empty answer', () => {
  clear();
  agentProcessFile('oldv', 4242, { v: ss.STATE_FILE_VERSION + 1 });
  // Review 1: a file whose name, cut as if it ended in .json, would key to a real agent ('good.saved' -> 'good.').
  fs.writeFileSync(nodePath.join(DIR(), 'good.saved'), '{"v":1,"pid":4242,"sessionId":"x"}');
  fs.writeFileSync(nodePath.join(DIR(), 'broken.json'), '{ not json');
  agentProcessFile('good', 4242);
  const running = create.runningJobs('win32', { isAlive: () => true });
  assert.deepEqual([...running].sort(), ['good'], 'only the readable state file of a live supervisor counts');
  clear();
  assert.deepEqual([...create.runningJobs('win32', { isAlive: () => true })], [], 'no state folder at all is nobody running');
});

test('kosmos#8410: the Windows arm never runs launchctl (it does not exist on Windows); the Mac arm still does (control)', () => {
  clear();
  agentProcessFile('ghost', 4242);
  const calls = [];
  create.setRunner((file, args) => { calls.push(String(file)); return { ok: true, stdout: '4242\t0\tcom.kosmos.agent.ghost\n' }; });
  try {
    create.runningJobs('win32', { isAlive: () => true });
    assert.deepEqual(calls.filter((f) => /launchctl/.test(f)), [], 'the Windows arm asked launchctl');
    create.runningJobs('darwin');
    assert.ok(calls.some((f) => /launchctl$/.test(f)), 'CONTROL: the Mac arm asks launchctl through the same runner');
  } finally { create.setRunner(null); }
});

test('kosmos#8410 review 1: a state file written before this boot is not believed (its pid may be somebody else\'s now)', () => {
  clear();
  agentProcessFile('ghost', 4242);
  agentProcessFile('fresh', 4242);
  const before = (Date.now() - 3600e3) / 1000;
  fs.utimesSync(nodePath.join(DIR(), 'ghost.json'), before, before);
  const bootMs = Date.now() - 60e3;   // booted a minute ago: ghost's file is an hour old
  const running = create.runningJobs('win32', { isAlive: () => true, bootMs });
  assert.equal(running.has('ghost'), false, 'a file from before this boot read as running');
  assert.ok(running.has('fresh'), 'CONTROL: a file written since boot still counts');
  assert.ok(create.runningJobs('win32', { isAlive: () => true, bootMs: 0 }).has('ghost'), 'CONTROL: with no boot rule the old file would count');
});

test('kosmos#8410 review 1: the real pid check, without a stand-in: this process is alive, an exited child is not', () => {
  clear();
  const { spawnSync } = require('node:child_process');
  const { pidAlive } = require('./win32orphan');
  agentProcessFile('me', process.pid);
  // Review 4: Windows reuses pids quickly and other test files run in parallel, so an exited child's pid can belong to
  // a new process by the time it is checked. Take an exited child whose pid reads dead right now (a few tries).
  let gone = null;
  for (let i = 0; i < 5 && gone === null; i++) {
    const p = spawnSync(process.execPath, ['-e', '0']).pid;
    if (!pidAlive(p)) gone = p;
  }
  assert.ok(gone !== null, 'CONTROL: five exited children all read alive at once; the pid check cannot be tested here');
  agentProcessFile('gone', gone);
  const running = create.runningJobs('win32');
  assert.ok(running.has('me'), 'this process read as not alive');
  assert.equal(running.has('gone'), false, 'an exited child read as alive');
});
