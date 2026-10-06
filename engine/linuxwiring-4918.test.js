'use strict';
/*
 * #4918 review 1 (Ice Cream Kitty): the Linux lifecycle WIRING, not only the linuxjob primitives. remove.js's
 * jobOps / jobFor and delete-leftover's plan, each driven with platform 'linux' and an injected systemd runner,
 * so nothing here reaches the host's real systemd (the runner refuses in a test process without one).
 *
 *   node --test engine/linuxwiring-4918.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-data-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-workers-'));   // never the real workers folder
const unitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-units-'));

const linuxjob = require('./linuxjob');
const remove = require('./remove');

let calls = [];
let answer = () => ({ ok: true, stdout: '' });
before(() => {
  linuxjob.setSystemdDirForTests(() => unitDir);
  linuxjob.setRunnerForTests((cmd, args) => { calls.push([cmd, ...args]); return answer(cmd, args); });
});
after(() => {
  fs.rmSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true, force: true });
  linuxjob.setRunnerForTests(null);
  linuxjob.setSystemdDirForTests(null);
  fs.rmSync(unitDir, { recursive: true, force: true });
});

test('#4918 remove.jobOps(linux) drives systemctl with the agent\'s (escaped) unit, and reports a refusal as false', () => {
  const ops = remove.jobOps('linux');
  assert.equal(ops.linux, true);
  const job = { worldId: 'w1' };
  const unit = linuxjob.unitName('kenshi', 'w1');
  calls = [];
  assert.equal(ops.disable('kenshi', job), true);
  assert.equal(ops.stopNow('kenshi', job), true);
  assert.deepEqual(calls, [['systemctl', '--user', 'disable', unit], ['systemctl', '--user', 'stop', unit]]);
  assert.match(unit, /^kosmos-agent-[A-Za-z0-9:_.\\-]+\.service$/, 'a valid systemd unit name');

  answer = (cmd, args) => (args[1] === 'enable' ? { ok: false, stderr: 'refused' } : { ok: true, stdout: '' });
  try {
    assert.equal(ops.startNow('kenshi', job), false, 'a start whose enable systemd refused reads as started');
    assert.ok(!calls.some((c) => c[2] === 'start'), 'it went on to start after the refusal');
  } finally { answer = () => ({ ok: true, stdout: '' }); }
});

test('#4918 remove.jobFor(linux) finds the agent by its unit file, and only then', () => {
  assert.equal(remove.jobFor('kenshi', 'linux', 'w1'), null, 'CONTROL: no unit file, no job');
  fs.writeFileSync(linuxjob.unitPath('kenshi', 'w1'), '[Service]\nExecStart="/bin/true"\n');
  try {
    const job = remove.jobFor('kenshi', 'linux', 'w1');
    assert.ok(job && job.ours, 'the unit file is not seen as the agent\'s job');
    assert.equal(job.label, linuxjob.unitName('kenshi', 'w1'));
  } finally { fs.rmSync(linuxjob.unitPath('kenshi', 'w1'), { force: true }); }
});

test('#4918 linuxjob.remove says when the unit file survived, so delete never lists it as gone', () => {
  const file = linuxjob.unitPath('kenshi', 'w1');
  fs.writeFileSync(file, '[Service]\n');
  assert.deepEqual(linuxjob.remove('kenshi', 'w1'), { ok: true });
  assert.equal(fs.existsSync(file), false);
  // A unit path that cannot be deleted (a folder where the file should be): not ok, with a reason.
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'x'), '');
  try {
    const r = linuxjob.remove('kenshi', 'w1');
    assert.equal(r.ok, false);
    assert.match(r.because, /could not be deleted|still there/);
  } finally { fs.rmSync(file, { recursive: true, force: true }); }
});

test('#4918 delete-leftover never promises the Trash for a systemd unit (it is deleted, not moved)', () => {
  const del = require('./delete-leftover');
  const create = require('./create');
  const name = 'leftoverlin';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(linuxjob.unitPath(name), '[Service]\n');
  try {
    const p = del.plan(name, { platform: 'linux' });
    assert.equal(p.ok, true, 'CONTROL: the leftover is planned: ' + JSON.stringify(p));
    assert.ok(create.workerDir(name).startsWith(process.env.AGENT_WORKFORCE_WORKERS), 'CONTROL: sandboxed workers folder');
    assert.ok(p.job && p.job.unit, 'the unit is not in the plan');
    assert.equal(p.toTrash, false, 'the plan promises the Trash for a unit it deletes');
    assert.doesNotMatch(p.reassurance, /goes to the Trash|move .* to the Trash/i, 'the sentence promises the Trash');
  } finally {
    fs.rmSync(linuxjob.unitPath(name), { force: true });
    fs.rmSync(create.workerDir(name), { recursive: true, force: true });
  }
});

test('#4918 review 2: a stop systemd refused (bus unreachable) makes remove not ok, and the file stays for a retry', () => {
  const file = linuxjob.unitPath('kenshi', 'w1');
  fs.writeFileSync(file, '[Service]\n');
  answer = (cmd, args) => (args[1] === 'stop' ? { ok: false, stderr: 'Failed to connect to bus: No medium found' } : { ok: true, stdout: '' });
  try {
    const r = linuxjob.remove('kenshi', 'w1');
    assert.equal(r.ok, false);
    assert.match(r.because, /could not stop it/);
    assert.equal(fs.existsSync(file), true, 'the unit file was deleted while systemd still runs the unit');
  } finally { answer = () => ({ ok: true, stdout: '' }); fs.rmSync(file, { force: true }); }
  // CONTROL: a unit that was never loaded is not a failure.
  fs.writeFileSync(file, '[Service]\n');
  answer = (cmd, args) => (args[1] === 'stop' ? { ok: false, stderr: 'Failed to stop x.service: Unit x.service not loaded.' } : { ok: true, stdout: '' });
  try { assert.deepEqual(linuxjob.remove('kenshi', 'w1'), { ok: true }); } finally { answer = () => ({ ok: true, stdout: '' }); }
});

test('#4918 review 3: the bus failure ("No such file or directory") is a failure, not "not loaded"', () => {
  const file = linuxjob.unitPath('kenshi', 'w1');
  fs.writeFileSync(file, '[Service]\n');
  answer = (cmd, args) => (args[1] === 'stop' ? { ok: false, stderr: 'Failed to connect to bus: No such file or directory' } : { ok: true, stdout: '' });
  try {
    const r = linuxjob.remove('kenshi', 'w1');
    assert.equal(r.ok, false, 'an unreachable bus read as a unit that was never loaded');
    assert.equal(fs.existsSync(file), true);
  } finally { answer = () => ({ ok: true, stdout: '' }); fs.rmSync(file, { force: true }); }
});

test('#4918 review 3: a test process cannot write a unit into the real systemd folder', () => {
  linuxjob.setSystemdDirForTests(null);
  const saved = process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  try {
    assert.throws(() => linuxjob.writeUnitFile(linuxjob.unitPath('kenshi', 'w1'), '[Service]\n'), /real folder/);
  } finally {
    if (saved !== undefined) process.env.AGENT_WORKFORCE_SYSTEMD_DIR = saved;
    linuxjob.setSystemdDirForTests(() => unitDir);
  }
  // CONTROL: with the folder pointed at a sandbox, the write goes through.
  linuxjob.writeUnitFile(linuxjob.unitPath('kenshi', 'w1'), '[Service]\n');
  assert.equal(fs.existsSync(linuxjob.unitPath('kenshi', 'w1')), true);
  fs.rmSync(linuxjob.unitPath('kenshi', 'w1'), { force: true });
});

test('#4918 review 3: removeBoard reports a refused stop and keeps the unit', () => {
  const linuxboard = require('./linuxboard');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-home-'));
  linuxboard.setSystemdDirForTests(() => unitDir);
  const target = linuxboard.boardUnitPath(home);
  fs.writeFileSync(target, '[Service]\n');
  linuxboard.setRunnerForTests((cmd, args) => (args[1] === 'stop' ? { ok: false, stderr: 'Failed to connect to bus: No such file or directory' } : { ok: true, stdout: '' }));
  try {
    const r = linuxboard.removeBoard(home);
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(target), true, 'the board unit was deleted while systemd may still run it');
    linuxboard.setRunnerForTests(() => ({ ok: true, stdout: '' }));
    assert.deepEqual(linuxboard.removeBoard(home), { ok: true }, 'CONTROL: a clean removal is ok');
    assert.equal(fs.existsSync(target), false);
  } finally {
    linuxboard.setRunnerForTests(null);
    linuxboard.setSystemdDirForTests(null);
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('#4918 review 4: disable\'s own "Unit file X.service does not exist" counts as already clean', () => {
  const file = linuxjob.unitPath('kenshi', 'w1');
  fs.writeFileSync(file, '[Service]\n');
  answer = (cmd, args) => (args[1] === 'stop'
    ? { ok: false, stderr: 'Failed to stop kosmos-agent-kenshi.service: Unit kosmos-agent-kenshi.service not loaded.' }
    : args[1] === 'disable'
      ? { ok: false, stderr: 'Failed to disable unit: Unit file kosmos-agent-kenshi.service does not exist.' }
      : { ok: true, stdout: '' });
  try {
    assert.deepEqual(linuxjob.remove('kenshi', 'w1'), { ok: true }, 'a unit systemd never had read as stuck');
  } finally { answer = () => ({ ok: true, stdout: '' }); fs.rmSync(file, { force: true }); }
});
