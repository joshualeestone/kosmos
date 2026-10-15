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
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  linuxjob.setRunnerForTests(null);
  linuxjob.setSystemdDirForTests(null);
  fs.rmSync(unitDir, { recursive: true, force: true });
});

test('#4918 remove.jobOps(linux) drives systemctl with the agent\'s (escaped) unit, and reports a refusal as false', (t) => {
  // review 6: the Linux ops go through remove.js's own run() (setRunner, dry run, live gate), as the Mac arm does.
  remove.setRunner((cmd, args) => { calls.push([cmd, ...args]); return answer(cmd, args); });
  t.after(() => remove.setRunner(null));
  const ops = remove.jobOps('linux');
  assert.equal(ops.linux, true);
  const job = { worldId: 'w1' };
  const unit = linuxjob.unitName('kenshi', 'w1');
  calls = [];
  assert.equal(ops.disable('kenshi', job), true);
  assert.equal(ops.stopNow('kenshi', job), true);
  assert.deepEqual(calls, [['systemctl', '--user', 'disable', unit], ['systemctl', '--user', 'stop', unit]]);
  assert.match(unit, /^kosmos-agent-[A-Za-z0-9:_.\\-]+\.service$/, 'a valid systemd unit name');

  // review 9: a restart's start never re-enables (the Mac's never does), and a refused reload stops it.
  calls = [];
  assert.equal(ops.startNow('kenshi', job), true);
  assert.ok(!calls.some((c) => c[2] === 'enable'), 'a restart re-enabled the unit (it would come back at every boot)');
  assert.ok(calls.some((c) => c[2] === 'start'), 'CONTROL: it did start');
  answer = (cmd, args) => (args[1] === 'daemon-reload' ? { ok: false, stderr: 'refused' } : { ok: true, stdout: '' });
  try {
    calls = [];
    assert.equal(ops.startNow('kenshi', job), false, 'a start after a refused reload reads as started');
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

test('#4918 delete-leftover: the folder goes to the Trash, the unit is removed, and the sentence says so', () => {
  const del = require('./delete-leftover');
  const create = require('./create');
  const name = 'leftoverlin';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(linuxjob.unitPath(name), '[Service]\n');
  // A Trash on the sandbox's own volume, so the folder CAN go there and the assertions below always run (review 31).
  const savedTrash = process.env.AGENT_WORKFORCE_TRASH;
  process.env.AGENT_WORKFORCE_TRASH = fs.mkdtempSync(path.join(path.dirname(process.env.AGENT_WORKFORCE_WORKERS), 'aw-trash-'));
  try {
    const p = del.plan(name, { platform: 'linux' });
    assert.equal(p.ok, true, 'CONTROL: the leftover is planned: ' + JSON.stringify(p));
    assert.ok(create.workerDir(name).startsWith(process.env.AGENT_WORKFORCE_WORKERS), 'CONTROL: sandboxed workers folder');
    assert.ok(p.job && p.job.unit, 'the unit is not in the plan');
    // review 31: the unit does not decide the folder's fate: the folder goes to the Trash, the unit is removed, and the
    // sentence says both (never "everything goes to the Trash").
    assert.equal(p.toTrash, true, 'a unit kept the folder out of the Trash');
    assert.match(p.reassurance, /Its files go to the Trash/);
    assert.match(p.reassurance, /startup job is removed/);
    assert.doesNotMatch(p.reassurance, /Everything goes to the Trash/);
    assert.ok(p.loses.some((l) => /^Its startup job/.test(l)), 'the unit is called an auto-start file: ' + JSON.stringify(p.loses));
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true, force: true });
    if (savedTrash === undefined) delete process.env.AGENT_WORKFORCE_TRASH; else process.env.AGENT_WORKFORCE_TRASH = savedTrash;
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

test('#4918 review 5/10: a world switch on Linux asks systemd, through create\'s run seam, whether each agent is on', (t) => {
  const ws = require('./worldstarts');
  const create = require('./create');
  let reachedOwn = 0;
  linuxjob.setRunnerForTests(() => { reachedOwn += 1; return { ok: true, stdout: 'enabled\n' }; });
  t.after(() => {
    create.setRunner(null);
    linuxjob.setRunnerForTests((cmd, args) => { calls.push([cmd, ...args]); return answer(cmd, args); });
  });
  for (const [out, code, want] of [['enabled\n', 0, 'on'], ['disabled\n', 1, 'off'], ['', 1, 'unknown']]) {
    // Shaped like execFileSync: exit 0 returns stdout, anything else throws carrying it (is-enabled exits 1 for disabled).
    create.setRunner((file, args) => {
      if (args[1] !== 'is-enabled') return { ok: true, stdout: '' };
      if (code === 0) return { ok: true, stdout: out };
      const e = new Error('Command failed'); e.status = code; e.stdout = out; e.stderr = ''; throw e;
    });
    assert.equal(ws.jobSwitchState('kenshi', 'linux', null), want, JSON.stringify(out));
  }
  assert.equal(reachedOwn, 0, 'the switch went around create\'s seam to linuxjob\'s own runner');
});

test('#4918 review 5: a sandboxed board (AGENT_WORKFORCE_LAUNCH) keeps its units in the sandbox', () => {
  linuxjob.setSystemdDirForTests(null);
  const savedDir = process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  const launch = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-launch-'));
  process.env.AGENT_WORKFORCE_LAUNCH = launch;
  try {
    assert.ok(linuxjob.systemdDir().startsWith(launch), 'the unit folder is not under the sandbox: ' + linuxjob.systemdDir());
    linuxjob.writeUnitFile(linuxjob.unitPath('kenshi', 'w1'), '[Service]\n');   // allowed: it is the sandbox
    assert.equal(fs.existsSync(linuxjob.unitPath('kenshi', 'w1')), true);
  } finally {
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    if (savedDir !== undefined) process.env.AGENT_WORKFORCE_SYSTEMD_DIR = savedDir;
    linuxjob.setSystemdDirForTests(() => unitDir);
    fs.rmSync(launch, { recursive: true, force: true });
  }
});

test('#4918 review 6: under remove.js\'s dry run, the Linux ops never reach systemd', () => {
  remove.setRunner(null);   // re-arms dry run
  let reached = 0;
  linuxjob.setRunnerForTests(() => { reached += 1; return { ok: true, stdout: '' }; });
  try {
    const ops = remove.jobOps('linux');
    ops.stopNow('kenshi', { worldId: 'w1' });
    ops.disable('kenshi', { worldId: 'w1' });
    assert.equal(reached, 0, 'a dry-run stop or disable reached the systemd runner');
  } finally {
    linuxjob.setRunnerForTests((cmd, args) => { calls.push([cmd, ...args]); return answer(cmd, args); });
  }
});

test('#4918 review 8: a Linux restart whose stop systemd refused is never reported as restarted', (t) => {
  const create = require('./create');
  const name = 'restartlin';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const unit = linuxjob.unitPath(name);
  fs.writeFileSync(unit, '[Service]\nExecStart="/bin/bash" "/x/agent-supervisor.sh" "restartlin" "/w" "/usr/bin/claude" "/usr/bin/tmux" "/w/start.log"\n');
  remove.setRunner((cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'systemctl' && args[1] === 'stop') return { ok: false, code: 1, stderr: 'Failed to stop: Connection timed out' };
    if (cmd === 'systemctl' && args[1] === 'is-active') return { ok: true, stdout: 'active\n' };
    return { ok: true, stdout: '' };
  });
  t.after(() => {
    remove.setRunner(null);
    fs.rmSync(unit, { force: true });
    fs.rmSync(create.workerDir(name), { recursive: true, force: true });
  });
  const r = remove.restart(name, 'test', { platform: 'linux', startIfDead: true });
  assert.notEqual(r.outcome, remove.OUTCOME.RESTARTED, 'a refused stop reported as a restart: ' + JSON.stringify(r));
});

/* #6183: the Linux restart acts are now STEPS the async driver runs with execFile (engine/remove.js jobOps(linux)
   `steps`), so an account move's restarts do not block the board once per agent, as #6173 did for the Mac. These two
   prove it the way #6173's Mac test does: an async restart sends every systemctl to the ASYNC runner and none to the
   synchronous one, and the board's thread keeps turning while they run; the sync control holds it. systemd's acts do
   not poll, so the per-command subprocess time is the contrast and is injected here (a timer for the async side, an
   Atomics.wait park for the sync side). */
function linuxRestartFixture(name) {
  const create = require('./create');
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const unit = linuxjob.unitPath(name);
  fs.writeFileSync(unit, '[Service]\nExecStart="/bin/bash" "/x/agent-supervisor.sh" "' + name + '" "/w" "/usr/bin/claude" "/usr/bin/tmux" "/w/start.log"\n');
  return { unit, workdir: create.workerDir(name) };
}
// stop/daemon-reload/start succeed; is-active reports the unit up so the loaded check passes on the first try.
function linuxRestartAnswer(cmd, args) {
  if (cmd === 'systemctl' && args[1] === 'is-active') return { ok: true, stdout: 'active\n' };
  return { ok: true, stdout: '' };
}
/* The longest the board's thread went without turning, by an interval: a blocking call shows as a gap (remove.test.js). */
function watchTurns6183() {
  let last = Date.now(), maxGap = 0, turns = 0;
  const iv = setInterval(() => { const t = Date.now(); maxGap = Math.max(maxGap, t - last); last = t; turns++; }, 5);
  return { stop: () => { clearInterval(iv); maxGap = Math.max(maxGap, Date.now() - last); return { maxGap, turns }; } };
}
function blockMs6183(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms | 0)); }

test('#6183: an async Linux restart sends every systemctl to the async runner and keeps the board turning', async (t) => {
  const name = 'asynclin';
  const status = require('./status');
  const { unit, workdir } = linuxRestartFixture(name);
  status.setPaneSource(() => '');   // empty board: a fromDead start, no session to close -- the job acts still run
  const sync = [], acalls = [];
  remove.setRunner((cmd, args) => { sync.push([cmd, ...args]); return { ok: false, code: 99 }; });   // must never be asked
  remove.setAsyncRunner(async (cmd, args) => { acalls.push([cmd, ...args]); await new Promise((r) => setTimeout(r, 80)); return linuxRestartAnswer(cmd, args); });   // 80 ms each: longer than the maxGap ceiling, so an inline command would be caught
  t.after(() => {
    remove.setRunner(null); remove.setAsyncRunner(null); status.setPaneSource(null);
    require('./disruption').clear(name);
    fs.rmSync(unit, { force: true }); fs.rmSync(workdir, { recursive: true, force: true });
  });
  const w = watchTurns6183();
  const out = await remove.restartAsync(name, 'account', { platform: 'linux', startIfDead: true });
  const { maxGap, turns } = w.stop();
  assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);
  assert.deepEqual(sync, [], 'a command went through the blocking runner');
  const systemctl = acalls.filter((c) => c[0] === 'systemctl').map((c) => c[2]);
  assert.deepEqual(systemctl, ['stop', 'daemon-reload', 'start', 'is-active'], 'the restart acts, all through the async runner');
  // Four commands at 80 ms each (320 ms of subprocess time) run off the board's thread via execFile. A 5 ms interval
  // fires dozens of times across that window (turns stays high), and no single 80 ms command ever holds the thread, so
  // the longest gap between fires stays well under one command. Were any command run inline, that gap would be >= 80 ms
  // (> 50) and turns would collapse toward the sync control's zero. The load-bearing proof is still that `sync` stayed
  // empty (above): every command went through the async runner.
  assert.ok(turns > 10, 'the board\'s thread barely turned during the restart (' + turns + ')');
  assert.ok(maxGap < 50, 'the board\'s thread was held for ' + maxGap + ' ms in one go (a command ran inline)');
});

test('#6183 control: a synchronous Linux restart holds the board for the whole of its systemctl calls', (t) => {
  const name = 'synclin';
  const status = require('./status');
  const { unit, workdir } = linuxRestartFixture(name);
  status.setPaneSource(() => '');
  remove.setRunner((cmd, args) => { blockMs6183(25); return linuxRestartAnswer(cmd, args); });   // execFileSync's blocking time, injected
  t.after(() => {
    remove.setRunner(null); status.setPaneSource(null);
    require('./disruption').clear(name);
    fs.rmSync(unit, { force: true }); fs.rmSync(workdir, { recursive: true, force: true });
  });
  let fired = 0;
  const iv = setInterval(() => { fired++; }, 5);
  const started = Date.now();
  const out = remove.restart(name, 'account', { platform: 'linux', startIfDead: true });
  const took = Date.now() - started;
  clearInterval(iv);
  assert.equal(out.outcome, remove.OUTCOME.RESTARTED, out.because);
  assert.equal(fired, 0, 'a timer fired during a synchronous restart: the board was not actually held');
  assert.ok(took >= 75, 'the sync restart took ' + took + ' ms, too little to show the board was held');   // >= 3 of 4 x 25 ms
});

/* #6183: drive a Linux restart step generator synchronously (these generators carry no {sleep} waits), collecting the
   exec specs it yields and feeding each the given answer. Returns the generator's return value and the specs sent, so
   a test can assert BOTH what the step decided and which systemctl commands it asked to run. */
function driveLinSteps(gen, answerExec) {
  const sent = [];
  let res = gen.next();
  while (!res.done) {
    assert.ok(res.value && Array.isArray(res.value.exec), 'a Linux step yielded a non-exec: ' + JSON.stringify(res.value));
    sent.push(res.value.exec);   // [file, args, opts]
    res = gen.next(answerExec(res.value.exec));
  }
  return { ret: res.value, sent };
}

test('#6183: loadedSteps yields is-active and reads a dry run as loaded (the command still reaches the runner)', () => {
  // A dry run is answered loaded WITHOUT skipping the is-active yield, so an injected runner always sees the command
  // -- the property remove.js's steps.loaded comment calls out, and the one the async proof depends on.
  const u = linuxjob.unitName('dryagent', undefined);
  const dry = driveLinSteps(linuxjob.loadedSteps('dryagent', undefined), () => ({ dryRun: true }));
  assert.equal(dry.ret, true, 'a dry run was not read as loaded');
  assert.deepEqual(dry.sent.map((e) => e[1]), [['--user', 'is-active', u]], 'is-active was not yielded under a dry run');
  assert.equal(driveLinSteps(linuxjob.loadedSteps('upagent', undefined), () => ({ ok: true, stdout: 'active\n' })).ret, true, 'an active unit was not read as loaded');
  assert.equal(driveLinSteps(linuxjob.loadedSteps('downagent', undefined), () => ({ ok: true, stdout: 'inactive\n' })).ret, false, 'an inactive unit was read as loaded');
});

test('#6183: startOnlySteps whose daemon-reload fails returns false and never yields start', () => {
  const r = driveLinSteps(linuxjob.startOnlySteps('reloadfail', undefined),
    (exec) => (exec[1][1] === 'daemon-reload' ? { ok: false, stderr: 'boom' } : { ok: true, stdout: '' }));
  assert.equal(r.ret, false, 'a failed daemon-reload was treated as a successful start');
  assert.deepEqual(r.sent.map((e) => e[1][1]), ['daemon-reload'], 'start was yielded after a failed reload');
});

test('#6183: a sandboxed board yields no systemctl command from any restart step (never acts on a real unit by name)', () => {
  linuxjob.setSystemdDirForTests(null);
  const savedDir = process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  const launch = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-sandbox-'));
  process.env.AGENT_WORKFORCE_LAUNCH = launch;
  const refuse = () => { throw new Error('a sandboxed step asked the runner to run a real systemctl command'); };
  try {
    assert.equal(driveLinSteps(linuxjob.stopSteps('sb', undefined), refuse).sent.length, 0, 'stopSteps yielded a command in the sandbox');
    assert.equal(driveLinSteps(linuxjob.startOnlySteps('sb', undefined), refuse).sent.length, 0, 'startOnlySteps yielded a command in the sandbox');
    assert.equal(driveLinSteps(linuxjob.loadedSteps('sb', undefined), refuse).sent.length, 0, 'loadedSteps yielded a command in the sandbox');
    assert.equal(driveLinSteps(linuxjob.statusSteps('sb', undefined), refuse).sent.length, 0, 'statusSteps yielded a command in the sandbox');
  } finally {
    delete process.env.AGENT_WORKFORCE_LAUNCH;
    if (savedDir !== undefined) process.env.AGENT_WORKFORCE_SYSTEMD_DIR = savedDir;
    linuxjob.setSystemdDirForTests(() => unitDir);
    fs.rmSync(launch, { recursive: true, force: true });
  }
});

test('#4918 review 8: a removal record that kept only the unit name acts on THAT world\'s unit', (t) => {
  remove.setRunner((cmd, args) => { calls.push([cmd, ...args]); return { ok: true, stdout: '' }; });
  t.after(() => remove.setRunner(null));
  calls = [];
  const record = { label: linuxjob.unitName('kenshi', 'w9'), ours: true };   // no worldId, as a removal record holds
  remove.jobOps('linux').enable('kenshi', record);
  assert.deepEqual(calls, [['systemctl', '--user', 'enable', linuxjob.unitName('kenshi', 'w9')]], 'enabled the current world\'s unit instead');
  assert.equal(linuxjob.worldFromUnitName('not-ours.service'), null, 'CONTROL: a foreign unit name has no world');
});

test('#4918 review 9: a unit with an incomplete ExecStart is said, never "(undefined)"', (t) => {
  const create = require('./create');
  const file = linuxjob.unitPath('halfunit');
  fs.writeFileSync(file, '[Service]\nExecStart="/bin/bash" "/x/agent-supervisor.sh"\n');
  t.after(() => fs.rmSync(file, { force: true }));
  const v = create.readJobVerdict('halfunit', undefined, 'linux');
  assert.equal(v.job, null);
  assert.equal(v.because, 'its ExecStart line is incomplete');
});

test('#4918 review 11: the register survey sees a Linux agent\'s systemd unit as its startup job', (t) => {
  const register = require('./register');
  const file = linuxjob.unitPath('survlin');
  const reader = register.jobReader('linux');
  assert.equal(reader.of('survlin'), false, 'CONTROL: no unit, no job');
  fs.writeFileSync(file, '[Service]\n');
  t.after(() => fs.rmSync(file, { force: true }));
  assert.equal(reader.of('survlin'), true, 'the survey says this agent does not come back after a restart');
});

test('#4918 review 12: installBoard ensures linger and says whether it is on, read back', (t) => {
  const linuxboard = require('./linuxboard');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-board-'));
  linuxboard.setSystemdDirForTests(() => unitDir);
  t.after(() => { linuxboard.setRunnerForTests(null); linuxboard.setSystemdDirForTests(null); fs.rmSync(home, { recursive: true, force: true }); });
  for (const [out, on] of [['Linger=yes\n', true], ['Linger=no\n', false]]) {
    const seen = [];
    linuxboard.setRunnerForTests((cmd, args) => { seen.push([cmd, ...args]); return cmd === 'loginctl' && args[0] === 'show-user' ? { ok: true, stdout: out } : { ok: true, stdout: '' }; });
    const r = linuxboard.installBoard(home, 17001);
    assert.equal(r.ok, true);
    assert.equal(r.lingering, on, out.trim());
    assert.ok(seen.some((c) => c[0] === 'loginctl' && c[1] === 'enable-linger'), 'linger was never asked for');
  }
});

test('#4918 review 19: the unit folder ignores the board\'s own XDG_CONFIG_HOME (systemd never reads it)', () => {
  linuxjob.setSystemdDirForTests(null);
  const saved = { x: process.env.XDG_CONFIG_HOME, d: process.env.AGENT_WORKFORCE_SYSTEMD_DIR, l: process.env.AGENT_WORKFORCE_LAUNCH };
  process.env.XDG_CONFIG_HOME = '/tmp/some-shell-only-config';
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR; delete process.env.AGENT_WORKFORCE_LAUNCH;
  try {
    assert.equal(linuxjob.systemdDir(), path.join(os.homedir(), '.config', 'systemd', 'user'));
  } finally {
    for (const [k, v] of [['XDG_CONFIG_HOME', saved.x], ['AGENT_WORKFORCE_SYSTEMD_DIR', saved.d], ['AGENT_WORKFORCE_LAUNCH', saved.l]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    linuxjob.setSystemdDirForTests(() => unitDir);
  }
});

test('#4918 review 20: a never-loaded unit is read by systemctl\'s exit 5 too, whatever the locale', () => {
  const file = linuxjob.unitPath('kenshi', 'w1');
  fs.writeFileSync(file, '[Service]\n');
  answer = (cmd, args) => (args[1] === 'stop' || args[1] === 'disable' ? { ok: false, code: 5, stderr: 'Einheit nicht geladen.' } : { ok: true, stdout: '' });
  try { assert.deepEqual(linuxjob.remove('kenshi', 'w1'), { ok: true }); } finally { answer = () => ({ ok: true, stdout: '' }); fs.rmSync(file, { force: true }); }
});

test('#4918 review 21: a sandboxed board with no deliberate unit folder never runs systemctl by name', () => {
  linuxjob.setSystemdDirForTests(null);
  const saved = { d: process.env.AGENT_WORKFORCE_SYSTEMD_DIR, l: process.env.AGENT_WORKFORCE_LAUNCH };
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-sbx-'));
  let reached = 0;
  linuxjob.setRunnerForTests(() => { reached += 1; return { ok: true, stdout: '' }; });
  try {
    const r = linuxjob.start('kenshi', 'w1');
    assert.equal(r.ok, false);
    assert.equal(reached, 0, 'a sandboxed board ran systemctl against the real user manager');
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true, force: true });
    for (const [k, v] of [['AGENT_WORKFORCE_SYSTEMD_DIR', saved.d], ['AGENT_WORKFORCE_LAUNCH', saved.l]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    linuxjob.setSystemdDirForTests(() => unitDir);
    linuxjob.setRunnerForTests((cmd, args) => { calls.push([cmd, ...args]); return answer(cmd, args); });
  }
});

test('#4918 review 22: a sandboxed board never runs systemctl against the real board unit', () => {
  const linuxboard = require('./linuxboard');
  linuxboard.setSystemdDirForTests(null);
  const saved = { d: process.env.AGENT_WORKFORCE_SYSTEMD_DIR, l: process.env.AGENT_WORKFORCE_LAUNCH };
  delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR;
  process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-bsbx-'));
  let reached = 0;
  linuxboard.setRunnerForTests(() => { reached += 1; return { ok: true, stdout: '' }; });
  try {
    linuxboard.removeBoard();
    assert.equal(reached, 0, 'a sandboxed board ran systemctl against the real board unit');
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true, force: true });
    for (const [k, v] of [['AGENT_WORKFORCE_SYSTEMD_DIR', saved.d], ['AGENT_WORKFORCE_LAUNCH', saved.l]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    linuxboard.setSystemdDirForTests(null);
    linuxboard.setRunnerForTests(null);
  }
});

test('#4918 review 28: removing an already-gone unit is ok when disable fails with localized text (exit 1, not 5)', () => {
  fs.rmSync(linuxjob.unitPath('kenshi', 'w1'), { force: true });
  answer = (cmd, args) => (args[1] === 'stop' ? { ok: false, code: 5, stderr: 'Einheit nicht geladen.' }
    : args[1] === 'disable' ? { ok: false, code: 1, stderr: 'Einheitendatei existiert nicht.' } : { ok: true, stdout: '' });
  try { assert.deepEqual(linuxjob.remove('kenshi', 'w1'), { ok: true }); } finally { answer = () => ({ ok: true, stdout: '' }); }
  // CONTROL: with the file present, a refused disable still says so.
  fs.writeFileSync(linuxjob.unitPath('kenshi', 'w1'), '[Service]\n');
  answer = (cmd, args) => (args[1] === 'disable' ? { ok: false, code: 1, stderr: 'Zugriff verweigert' } : { ok: true, stdout: '' });
  try { assert.equal(linuxjob.remove('kenshi', 'w1').ok, false); } finally { answer = () => ({ ok: true, stdout: '' }); fs.rmSync(linuxjob.unitPath('kenshi', 'w1'), { force: true }); }
});

test('#4918 review 29: removeBoard of an already-gone unit is ok when disable fails with localized text', () => {
  const linuxboard = require('./linuxboard');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxwiring-board-'));
  linuxboard.setSystemdDirForTests(() => dir);
  linuxboard.setRunnerForTests((cmd, args) => (args[1] === 'stop' ? { ok: false, code: 5, stderr: 'Einheit nicht geladen.' }
    : args[1] === 'disable' ? { ok: false, code: 1, stderr: 'Einheitendatei existiert nicht.' } : { ok: true, stdout: '' }));
  try { assert.deepEqual(linuxboard.removeBoard(), { ok: true }); } finally {
    linuxboard.setSystemdDirForTests(null); linuxboard.setRunnerForTests(null); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#4918 review 31: with no Trash and a startup job systemd will not remove, the folder is kept, not deleted for good', () => {
  const del = require('./delete-leftover');
  const create = require('./create');
  const name = 'leftoverbus';
  const savedTrash = process.env.AGENT_WORKFORCE_TRASH;
  process.env.AGENT_WORKFORCE_TRASH = path.join(os.tmpdir(), 'aw-no-such-trash-' + process.pid);   // no Trash at all
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(name), 'work.txt'), 'x');
  fs.writeFileSync(linuxjob.unitPath(name), '[Service]\n');
  del.setRunner((file, args) => (file === 'systemctl' && args[1] === 'stop' ? { ok: false, stderr: 'Failed to connect to bus: No such file or directory' } : { ok: true, stdout: '' }));
  try {
    const p = del.plan(name, { platform: 'linux' });
    assert.equal(p.toTrash, false, 'CONTROL: with no Trash the folder would be deleted for good');
    const r = del.del(name, { platform: 'linux', typed: p.typeToConfirm || name });
    assert.equal(fs.existsSync(path.join(create.workerDir(name), 'work.txt')), true, 'the folder was deleted for good while the unit stayed');
    assert.notEqual(r.outcome, del.OUTCOME.DELETED, JSON.stringify(r));
  } finally {
    if (savedTrash === undefined) delete process.env.AGENT_WORKFORCE_TRASH; else process.env.AGENT_WORKFORCE_TRASH = savedTrash;
    del.setRunner(null);
    fs.rmSync(linuxjob.unitPath(name), { force: true });
    fs.rmSync(create.workerDir(name), { recursive: true, force: true });
  }
});

test('#4918 review 32: a unit-only leftover never promises the Trash, and the result says nothing starts it', () => {
  const del = require('./delete-leftover');
  const name = 'leftoverunit';
  fs.writeFileSync(linuxjob.unitPath(name), '[Service]\n');
  del.setRunner(() => ({ ok: true, stdout: '' }));
  try {
    const p = del.plan(name, { platform: 'linux' });
    assert.equal(p.ok, true, JSON.stringify(p));
    assert.equal(p.toTrash, false, 'a unit-only leftover promised the Trash');
    assert.doesNotMatch(p.reassurance, /Trash/);
    const r = del.del(name, { platform: 'linux', typed: p.typeToConfirm || name });
    assert.match(r.said, /Nothing starts/, JSON.stringify(r));
  } finally { del.setRunner(null); fs.rmSync(linuxjob.unitPath(name), { force: true }); }
});

test('#4918 review 32: with a Trash, a startup job systemd will not remove still keeps the folder', () => {
  const del = require('./delete-leftover');
  const create = require('./create');
  const name = 'leftoverbus2';
  const savedTrash = process.env.AGENT_WORKFORCE_TRASH;
  process.env.AGENT_WORKFORCE_TRASH = fs.mkdtempSync(path.join(path.dirname(process.env.AGENT_WORKFORCE_WORKERS), 'aw-trash-'));
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir(name), 'work.txt'), 'x');
  fs.writeFileSync(linuxjob.unitPath(name), '[Service]\n');
  const removeMod = require('./remove');
  const origForget = removeMod.forget;
  let forgot = 0;
  removeMod.forget = (...a) => { forgot += 1; return origForget(...a); };
  del.setRunner((file, args) => (file === 'systemctl' && args[1] === 'stop' ? { ok: false, stderr: 'Failed to connect to bus: No such file or directory' } : { ok: true, stdout: '' }));
  try {
    const p = del.plan(name, { platform: 'linux' });
    assert.equal(p.toTrash, true, 'CONTROL: the Trash can take the folder');
    const r = del.del(name, { platform: 'linux', typed: p.typeToConfirm || name });
    assert.equal(fs.existsSync(path.join(create.workerDir(name), 'work.txt')), true, 'the folder moved while the unit still holds the name');
    assert.notEqual(r.outcome, del.OUTCOME.DELETED, JSON.stringify(r));
    assert.match(r.because, /folder was kept too/, 'the sentence says the folder could not move, not that it was kept (review 34)');
    assert.equal(forgot, 0, 'the removal record was dropped though nothing was deleted (review 35)');
    assert.match(r.because, /standing in the community was reset/, 'the irreversible standing reset is not said (review 37)');
  } finally {
    fs.rmSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true, force: true });
    if (savedTrash === undefined) delete process.env.AGENT_WORKFORCE_TRASH; else process.env.AGENT_WORKFORCE_TRASH = savedTrash;
    removeMod.forget = origForget;
    del.setRunner(null);
    fs.rmSync(linuxjob.unitPath(name), { force: true });
    fs.rmSync(create.workerDir(name), { recursive: true, force: true });
  }
});

test('#4918 review 33: a Linux restore whose unit file is gone says so, not "start it by hand"', (t) => {
  const create = require('./create');
  const name = 'restorelin';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const unit = linuxjob.unitPath(name);
  fs.writeFileSync(unit, '[Service]\nExecStart="/bin/bash" "/x/agent-supervisor.sh" "restorelin" "/w" "/usr/bin/claude" "/usr/bin/tmux" "/w/start.log"\n');
  remove.setRunner((cmd, args) => {
    // enable of a missing unit file fails, as systemctl does; everything else succeeds
    if (cmd === 'systemctl' && args[1] === 'enable' && !fs.existsSync(unit)) return { ok: false, code: 1, stderr: 'Failed to enable unit: Unit file restorelin.service does not exist.' };
    if (cmd === 'systemctl' && args[1] === 'is-active') return { ok: true, stdout: 'inactive\n' };
    return { ok: true, stdout: '' };
  });
  t.after(() => {
    remove.setRunner(null);
    fs.rmSync(unit, { force: true });
    fs.rmSync(create.workerDir(name), { recursive: true, force: true });
  });
  const off = remove.remove(name, { platform: 'linux', keepJobFile: true });
  assert.ok(off && off.outcome, 'CONTROL: the agent was removed: ' + JSON.stringify(off));
  fs.rmSync(unit, { force: true });   // the unit file is then deleted by hand
  const r = remove.restore(name, { platform: 'linux' });
  assert.equal(r.outcome, remove.OUTCOME.PARTIAL, JSON.stringify(r));
  assert.match(r.because, /no longer on this computer/, 'the person was told to start by hand something that is gone');
});

test('#4918 review 34: a Linux repair counts an agent systemd already runs as started', () => {
  const create = require('./create');
  const register = require('./register');
  const name = 'repairlin';
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const store = require('./store');
  assert.ok(String(store.PROFILES).startsWith(process.env.AGENT_WORKFORCE_DATA), 'CONTROL: the profile store is the sandbox: ' + store.PROFILES);
  store.writeProfile(name, { role: 'pm' });
  const orig = create.installJob;
  const asked = [];
  create.installJob = (n) => { asked.push(n); return { ok: true, started: false, alreadyRunning: true }; };
  try {
    const r = register.repair({ platform: 'linux' });
    assert.ok(asked.includes(name), 'CONTROL: the repair reached the folder with no unit: ' + JSON.stringify(r));
    const mine = r.results.filter((x) => x.name === name).length;
    assert.ok(r.started >= mine && mine === 1, 'an agent already running was not counted as started: ' + JSON.stringify(r));
  } finally { create.installJob = orig; fs.rmSync(create.workerDir(name), { recursive: true, force: true }); }
});

test('#4918 review 39: an import whose agent is running is started; one running but refused its enable says so plainly', () => {
  const create = require('./create');
  const trust = require('./trust');
  const worldstarts = require('./worldstarts');
  const origInstall = create.installJob;
  const origTrust = trust.trustFolder;
  trust.trustFolder = () => ({ ok: true });   // never the real Claude trust file
  try {
    create.installJob = () => ({ ok: true, started: false, alreadyRunning: true, atLogin: true, because: 'x' });
    assert.equal(worldstarts.firstStartOfImport({ name: 'importlin' }, 'linux'), null, 'a running agent was reported as held');
    create.installJob = () => ({ ok: true, started: false, alreadyRunning: false, runningButNotEnabled: true, atLogin: false, because: 'x' });
    const said = worldstarts.firstStartOfImport({ name: 'importlin' }, 'linux');
    assert.match(String(said), /running now on its old settings/);
    assert.doesNotMatch(String(said), /could not start/, 'the sentence says it did not start and is running');
    create.installJob = () => ({ ok: true, started: false, atLogin: false, because: 'systemd did not enable the agent' });
    assert.match(String(worldstarts.firstStartOfImport({ name: 'importlin' }, 'linux')), /could not start/, 'CONTROL: a real failure still says so');
  } finally { create.installJob = origInstall; trust.trustFolder = origTrust; }
});

test('#4918 review 40: a unit-only leftover systemd will not remove keeps its records too', () => {
  const del = require('./delete-leftover');
  const removeMod = require('./remove');
  const name = 'leftoverbus3';
  fs.writeFileSync(linuxjob.unitPath(name), '[Service]\n');
  const origForget = removeMod.forget;
  let forgot = 0;
  removeMod.forget = (...a) => { forgot += 1; return origForget(...a); };
  del.setRunner((file, args) => (file === 'systemctl' && args[1] === 'stop' ? { ok: false, stderr: 'Failed to connect to bus: No such file or directory' } : { ok: true, stdout: '' }));
  try {
    const p = del.plan(name, { platform: 'linux' });
    const r = del.del(name, { platform: 'linux', typed: p.typeToConfirm || name });
    assert.equal(r.outcome, del.OUTCOME.REFUSED, JSON.stringify(r));
    assert.equal(forgot, 0, 'the removal record was dropped while systemd still holds the unit');
    assert.doesNotMatch(r.because, /folder was kept/, 'a unit-only leftover has no folder to keep');
  } finally { removeMod.forget = origForget; del.setRunner(null); fs.rmSync(linuxjob.unitPath(name), { force: true }); }
});
