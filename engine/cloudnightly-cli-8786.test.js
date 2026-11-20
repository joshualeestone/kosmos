'use strict';
/**
 * kosmos#8786 S2: `kosmos cloud-update`, the Cloud box's nightly command, from the real install/kosmos with stubbed
 * engine modules in a throwaway KOSMOS_HOME. What decide() decides is engine/cloudnightly-8786.test.js; this pins what
 * the CLI does with each answer: a quiet skip leaves no line, a said skip logs it, and a run reaches the update look
 * with the PROD channel and logs the look's answer. The live run on a real box is the card's measurement.
 *
 *   node --test engine/cloudnightly-cli-8786.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KOSMOS = path.join(__dirname, '..', 'install', 'kosmos');

/* A home whose app/engine holds the two stubs kosmos_engine_module finds before the source tree. */
function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-cloudnightly-cli-8786-'));
  fs.mkdirSync(path.join(h, 'app', 'engine'), { recursive: true });
  fs.writeFileSync(path.join(h, 'app', 'engine', 'cloudnightly.js'),
    "if (process.argv[2] === 'decide') process.stdout.write(process.env.STUB_DECIDE + '\\n');\n");
  // The update look answers `current <the channel it was handed>`, so the log shows which pointer the run asked for.
  fs.writeFileSync(path.join(h, 'app', 'engine', 'update-ifnewer.js'),
    "process.stdout.write('current\\t' + (process.env.KOSMOS_UPDATE_CHANNEL || 'none') + '\\n');\n");
  return h;
}

function run(h, decide) {
  const env = { ...process.env, KOSMOS_HOME: h, KOSMOS_PLATFORM: 'Linux', STUB_DECIDE: decide };
  // Not an agent: a test run inside an agent's pane would be refused as one (and must not touch the live session).
  for (const k of ['TMUX', 'TMUX_PANE', 'KOSMOS_AGENT_SESSION', 'KOSMOS_AGENT_TOKEN', 'KOSMOS_UPDATE_CHANNEL', 'AGENT_WORKFORCE_UPDATE_CHANNEL']) delete env[k];
  return spawnSync('bash', [KOSMOS, 'cloud-update'], { env, encoding: 'utf8', timeout: 30000 });
}
const log = (h) => { try { return fs.readFileSync(path.join(h, 'logs', 'install.log'), 'utf8'); } catch { return ''; } };

test('a quiet skip (not a Cloud box) exits 0 and writes nothing', () => {
  const h = home();
  const r = run(h, 'skip\tquiet\tnot a Kosmos Cloud computer');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(log(h), '');
});

test('a said skip is one cloud-update line in install.log, and nothing is looked up', () => {
  const h = home();
  const r = run(h, 'skip\tsaid\tupdates are turned off in Settings');
  assert.equal(r.status, 0, r.stderr);
  assert.match(log(h), /^\S+Z cloud-update: skipped tonight: updates are turned off in Settings\n$/);
});

test('no answer from the check is a said skip, not a run', () => {
  const h = home();
  const r = run(h, '');
  assert.equal(r.status, 0, r.stderr);
  assert.match(log(h), /cloud-update: skipped tonight: the nightly check gave no answer/);
  assert.doesNotMatch(log(h), /current/);
});

test('a run reaches the update look on the PROD channel and logs its answer', () => {
  const h = home();
  const r = run(h, 'run');
  assert.equal(r.status, 0, r.stderr);
  const l = log(h);
  assert.match(l, /cloud-update: looking for a newer prod build\n/);
  assert.match(l, /cloud-update: current prod \(exit 0\)\n$/, 'the look was handed KOSMOS_UPDATE_CHANNEL=prod: ' + l);
});

test('CONTROL: the channel stub can show another channel, so the prod line above is not a constant', () => {
  const h = home();
  const env = { ...process.env, KOSMOS_HOME: h, KOSMOS_UPDATE_CHANNEL: 'staging' };
  const r = spawnSync(process.execPath, [path.join(h, 'app', 'engine', 'update-ifnewer.js')], { env, encoding: 'utf8' });
  assert.equal(r.stdout, 'current\tstaging\n');
});

test('a run while another install is under way logs the refusal and its exit', () => {
  const h = home();
  fs.mkdirSync(path.join(h, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(h, 'logs', 'install.started'), 'x\n');
  const r = run(h, 'run');
  assert.equal(r.status, 3);
  assert.match(log(h), /cloud-update: refused an update is already being installed on this computer \(exit 3\)/);
});
