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

let systemd = () => ({ ok: true, stdout: '' });
const calls = [];
linuxjob.setRunnerForTests((cmd, args) => { calls.push([cmd, ...args]); return systemd(cmd, args); });
create.setRunner(() => ({ ok: true, stdout: '' }));
create.setDryRun(false);

test.after(() => {
  linuxjob.setRunnerForTests(null);
  create.setRunner(null);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };
const lingerIs = (yes) => (cmd, args) => (cmd === 'loginctl' && args[0] === 'show-user'
  ? { ok: true, stdout: yes ? 'Linger=yes\n' : 'Linger=no\n' }
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
