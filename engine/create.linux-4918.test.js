'use strict';
/*
 * #4918 review 1 and 5 (Ice Cream Kitty): createAgent's Linux arm, end to end in a sandbox. The unit is written and
 * started through linuxjob, linger is read back and said, and a start systemd refuses rolls the agent back. Every
 * command is faked: create's runner and linuxjob's systemd runner, and the unit folder sits under the sandbox
 * (AGENT_WORKFORCE_LAUNCH), so nothing reaches the host.
 *
 *   node --test engine/create.linux-4918.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'create-linux-4918-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
// review 21: a deliberate unit folder: a sandbox without one refuses every systemctl (it would name real units).
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(SANDBOX, 'systemd-user');

const create = require('./create');
const linuxjob = require('./linuxjob');

/* review 7: create's systemd calls go through create's own runner (linuxRun). This fake behaves like the real one,
   execFileSync: it RETURNS stdout on exit 0 and THROWS (status, stdout, stderr) otherwise. A fake that returned
   { ok:false } for a failure is the shape that hid a crash on the first agent of every Linux board. */
let systemd = () => ({ ok: true, stdout: '' });
const calls = [];
const fakeRunner = (file, args) => {
  if (file !== 'systemctl' && file !== 'loginctl') return { ok: true, stdout: '' };
  calls.push([file, ...args]);
  const r = systemd(file, args);
  if (r.ok) return { ok: true, stdout: r.stdout || '' };
  const err = new Error('Command failed: ' + file + ' ' + args.join(' '));
  err.status = r.code == null ? 1 : r.code; err.stdout = r.stdout || ''; err.stderr = r.stderr || '';
  throw err;
};
create.setRunner(fakeRunner);
create.setDryRun(false);
linuxjob.setRunnerForTests(() => { throw new Error('create went around its own runner to linuxjob\'s'); });

test.after(() => {
  linuxjob.setRunnerForTests(null);
  create.setRunner(null);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };
// A fresh name: is-active answers "inactive" with exit 3, exactly as systemctl does.
const lingerIs = (yes) => (cmd, args) => (cmd === 'loginctl' && args[0] === 'show-user'
  ? { ok: true, stdout: yes ? 'Linger=yes\n' : 'Linger=no\n' }
  : (cmd === 'systemctl' && args[1] === 'is-active') ? { ok: false, code: 3, stdout: 'inactive\n' }
  : { ok: true, stdout: '' });

test('#4918 create on Linux writes the unit under the sandbox and starts it through systemd', () => {
  systemd = lingerIs(true);
  calls.length = 0;
  const r = create.createAgent({ ...BINS, name: 'linbot', role: 'pm', platform: 'linux' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, JSON.stringify(r));
  const unit = linuxjob.unitPath('linbot');
  assert.ok(unit.startsWith(process.env.AGENT_WORKFORCE_SYSTEMD_DIR), 'the unit is not in the test unit folder: ' + unit);
  assert.ok(fs.existsSync(unit), 'no unit file was written');
  assert.ok(calls.some((c) => c[0] === 'systemctl' && c.includes('start')), 'systemd was never asked to start it');
  assert.equal(r.because, 'linbot is set up and starting');
  const kept = r.steps.find((s) => s.label === 'kept it running with nobody logged in');
  assert.ok(kept && kept.ok === true, 'CONTROL: with linger on, the step is done');
});

test('#4918 with linger off, create says the agent stops at logout (a visible step and the sentence)', () => {
  systemd = lingerIs(false);
  const r = create.createAgent({ ...BINS, name: 'linbot2', role: 'pm', platform: 'linux' });
  assert.equal(r.outcome, create.OUTCOME.CREATED, JSON.stringify(r));
  const kept = r.steps.find((s) => s.label === 'kept it running with nobody logged in');
  assert.ok(kept && kept.ok === false, 'the linger step does not say it is not done');
  assert.match(r.because, /stops when you log out/);
});

test('#4918 a start systemd refuses is not reported as created', () => {
  systemd = (cmd, args) => (args[1] === 'enable' ? { ok: false, stderr: 'Unit file is not valid' } : lingerIs(true)(cmd, args));
  const r = create.createAgent({ ...BINS, name: 'linbot3', role: 'pm', platform: 'linux' });
  assert.equal(r.outcome, create.OUTCOME.PARTIAL, 'a refused start reads as something other than taken back: ' + JSON.stringify(r));
  assert.match(r.because, /did not enable the agent/, 'systemd\'s reason is not shown (#4918 review 8)');
  assert.equal(fs.existsSync(linuxjob.unitPath('linbot3')), false, 'the unit was left behind after the roll back');
});

test('#4918 review 7: a name systemd still runs with no unit file left gets the command that frees it', () => {
  systemd = (cmd, args) => ((cmd === 'systemctl' && args[1] === 'is-active') ? { ok: true, stdout: 'active\n' } : lingerIs(true)(cmd, args));
  const r = create.createAgent({ ...BINS, name: 'ghostbot', role: 'pm', platform: 'linux' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, JSON.stringify(r));
  assert.match(r.because, /systemctl --user stop 'kosmos-agent-ghostbot\.service'/, 'the unit is quoted so a pasted \\x2b survives the shell');
});

test('#4918 review 23: a dry-run Linux board creates; create\'s name check reads a dry run as not running', () => {
  systemd = lingerIs(true);
  // The real dry-run shape: no runner (run() checks the runner first, so a fake would hide it).
  create.setRunner(null);
  create.setDryRun(true);
  try {
    const r = create.createAgent({ ...BINS, name: 'drybot', role: 'pm', platform: 'linux' });
    assert.notEqual(r.outcome, create.OUTCOME.REFUSED, 'a dry run refused the name as still running: ' + JSON.stringify(r));
  } finally { create.setRunner(fakeRunner); create.setDryRun(false); }
});

test('#4918 review 23: an install over a unit that is already active is not "started now"', () => {
  fs.mkdirSync(create.workerDir('activebot'), { recursive: true });
  systemd = (cmd, args) => ((cmd === 'systemctl' && args[1] === 'is-active') ? { ok: true, stdout: 'active\n' } : lingerIs(true)(cmd, args));
  const r = create.installJob('activebot', { ...BINS, platform: 'linux' });
  assert.equal(r.started, false, 'a start of an active unit (a no-op) was reported as started: ' + JSON.stringify(r));
  assert.match(r.because, /already has it loaded/, 'an agent systemd has loaded was told it could not start (review 25)');
  systemd = lingerIs(true);
  fs.mkdirSync(create.workerDir('activebot2'), { recursive: true });
  const c = create.installJob('activebot2', { ...BINS, platform: 'linux' });
  assert.equal(c.started, true, 'CONTROL: a fresh install starts: ' + JSON.stringify(c));
});

test('#4918 review 27: an orphan unit with no folder holds its name on Linux, as a plist does on the Mac', () => {
  systemd = lingerIs(true);
  const u = linuxjob.unitPath('orphanbot');
  fs.mkdirSync(path.dirname(u), { recursive: true });
  fs.writeFileSync(u, '[Service]\n');
  try {
    const r = create.createAgent({ ...BINS, name: 'orphanbot', role: 'pm', platform: 'linux' });
    assert.equal(r.outcome, create.OUTCOME.REFUSED, 'an orphan unit did not hold its name: ' + JSON.stringify(r));
    assert.match(r.because, /systemctl --user disable --now 'kosmos-agent-orphanbot\.service'/, 'the Linux refusal does not give the command that frees the name (review 31)');
  } finally { fs.rmSync(u, { force: true }); }
});

test('#4918 review 27: with the user bus unreachable, the roll back removes the never-loaded unit, so the name is free', () => {
  const bus = { ok: false, code: 1, stderr: 'Failed to connect to bus: No such file or directory' };
  systemd = (cmd, args) => (cmd === 'systemctl' && args[1] !== 'is-active' ? bus : lingerIs(true)(cmd, args));
  const r = create.createAgent({ ...BINS, name: 'busbot', role: 'pm', platform: 'linux' });
  assert.notEqual(r.outcome, create.OUTCOME.CREATED, JSON.stringify(r));
  assert.equal(fs.existsSync(linuxjob.unitPath('busbot')), false, 'a never-loaded unit was left holding the name');
  assert.match(r.because, /user services are not reachable/);
});

test('#4918 review 35: a value a systemd unit cannot hold is said to the person, not "try that name again"', () => {
  systemd = lingerIs(true);
  const saved = process.env.TMUX_TMPDIR;
  process.env.TMUX_TMPDIR = '/tmp/a%b';
  try {
    const r = create.createAgent({ ...BINS, name: 'pctbot', role: 'pm', platform: 'linux' });
    assert.notEqual(r.outcome, create.OUTCOME.CREATED, JSON.stringify(r));
    assert.match(r.because, /cannot go into a systemd unit/, 'the refusal reason is hidden: ' + r.because);
    assert.doesNotMatch(r.because, /you can try that name again/);
  } finally { if (saved === undefined) delete process.env.TMUX_TMPDIR; else process.env.TMUX_TMPDIR = saved; }
});
