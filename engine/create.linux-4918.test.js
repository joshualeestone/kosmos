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
delete process.env.AGENT_WORKFORCE_SYSTEMD_DIR;

const create = require('./create');
const linuxjob = require('./linuxjob');

/* review 7: create's systemd calls go through create's own runner (linuxRun). This fake behaves like the real one,
   execFileSync: it RETURNS stdout on exit 0 and THROWS (status, stdout, stderr) otherwise. A fake that returned
   { ok:false } for a failure is the shape that hid a crash on the first agent of every Linux board. */
let systemd = () => ({ ok: true, stdout: '' });
const calls = [];
create.setRunner((file, args) => {
  if (file !== 'systemctl' && file !== 'loginctl') return { ok: true, stdout: '' };
  calls.push([file, ...args]);
  const r = systemd(file, args);
  if (r.ok) return { ok: true, stdout: r.stdout || '' };
  const err = new Error('Command failed: ' + file + ' ' + args.join(' '));
  err.status = r.code == null ? 1 : r.code; err.stdout = r.stdout || ''; err.stderr = r.stderr || '';
  throw err;
});
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
  assert.ok(unit.startsWith(process.env.AGENT_WORKFORCE_LAUNCH), 'the unit is not under the sandbox: ' + unit);
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
  assert.notEqual(r.outcome, create.OUTCOME.CREATED, 'a refused start reads as created: ' + JSON.stringify(r));
});

test('#4918 review 7: a name systemd still runs with no unit file left gets the command that frees it', () => {
  systemd = (cmd, args) => ((cmd === 'systemctl' && args[1] === 'is-active') ? { ok: true, stdout: 'active\n' } : lingerIs(true)(cmd, args));
  const r = create.createAgent({ ...BINS, name: 'ghostbot', role: 'pm', platform: 'linux' });
  assert.equal(r.outcome, create.OUTCOME.REFUSED, JSON.stringify(r));
  assert.match(r.because, /systemctl --user stop kosmos-agent-ghostbot\.service/);
});
