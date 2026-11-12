'use strict';
/**
 * kosmos#8410 review 4: ending an agent's task clears the state file its supervisor kept, once that file's process is
 * gone. `schtasks /End` kills a supervisor before its own clear-on-exit runs, so the file used to outlive every Stop,
 * and once Windows handed its pid to another process, create.runningJobs (win32streamstate.liveNames) read the
 * stopped agent as "could not check" instead of "Not running". These drive win32job.end and endSteps with a recorded
 * schtasks, and pin: a file whose process is gone is cleared; one whose process is alive is kept (that is true); a
 * failed /End clears nothing; and a newer supervisor's file (another pid) is never touched.
 *
 *   node -r ./tools/no-schtasks-preload.cjs --test engine/win32job.end-clears-8410.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'win32job-end-8410-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const store = require('./store');
const job = require('./win32job');
const ss = require('./win32streamstate');
const create = require('./create');

const DIR = () => nodePath.join(store.ROOT, 'win32-state');
const FILE = (name) => nodePath.join(DIR(), `${name}.json`);
function stateFile(name, pid) {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(FILE(name), JSON.stringify({ v: ss.STATE_FILE_VERSION, state: 'idle', sessionId: `s-${name}`, pid, at: new Date().toISOString() }));
}
function schtasks(reply) {
  const calls = [];
  job.setRunner((args) => { calls.push(args.slice()); return reply; });
  return calls;
}
test.afterEach(() => { job.setRunner(null); fs.rmSync(DIR(), { recursive: true, force: true }); });

test('kosmos#8410 review 4: after an /End that went through, the state file of a process that is gone is cleared', () => {
  stateFile('ghost', 4242);
  const calls = schtasks({ ok: true, out: '' });
  job.setEndAlive(() => false);
  assert.equal(job.end('ghost').ok, true);
  assert.ok(calls.some((a) => a[0] === '/End'), 'CONTROL: the stop asked schtasks to end the task');
  assert.equal(fs.existsSync(FILE('ghost')), false, 'the stopped agent\'s state file was left behind');
  assert.equal(create.runningJobs('win32', { isAlive: () => true }).has('ghost'), false,
    'a reused pid would still read the stopped agent as running');
});

test('kosmos#8410 review 4 control: a process still alive after /End keeps its file (that is true), and so does a failed /End', () => {
  stateFile('ghost', 4242);
  schtasks({ ok: true, out: '' });
  job.setEndAlive(() => true);
  job.end('ghost');
  assert.ok(fs.existsSync(FILE('ghost')), 'a file whose process is alive was cleared');
  schtasks({ ok: false, out: 'ERROR: Access is denied.' });
  job.setEndAlive(() => false);
  assert.equal(job.end('ghost').ok, false, 'CONTROL: the /End was refused');
  assert.ok(fs.existsSync(FILE('ghost')), 'a failed /End cleared the file');
});

test('kosmos#8410 review 4: the step form (the restart driver) clears it the same way', () => {
  stateFile('ghost', 4242);
  job.setEndAlive(() => false);
  const g = job.endSteps('ghost');
  const asked = g.next();
  assert.deepEqual(asked.value.exec.slice(0, 2), ['schtasks.exe', ['/End', '/TN', job.taskName('ghost')]], 'CONTROL: the step yields the /End');
  const done = g.next({ ok: true, stdout: '', code: 0 });
  assert.equal(done.done, true);
  assert.equal(done.value.ok, true);
  assert.equal(fs.existsSync(FILE('ghost')), false, 'the step form left the stopped agent\'s file behind');
});

test('kosmos#8410 review 4: only the file that names the gone process is cleared, never another agent\'s', () => {
  stateFile('ghost', 4242);
  stateFile('other', 5151);
  schtasks({ ok: true, out: '' });
  job.setEndAlive(() => false);
  job.end('ghost');
  assert.equal(fs.existsSync(FILE('ghost')), false, 'CONTROL: the ended agent\'s file is cleared');
  assert.ok(fs.existsSync(FILE('other')), 'ending one agent cleared another agent\'s file');
});
