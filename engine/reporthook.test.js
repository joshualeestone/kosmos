'use strict';

// Both sandbox knobs BEFORE any require, travelling together per #527:
// accounts resolves HOME through AGENT_WORKFORCE_HOME at module load, and
// store resolves its root from AGENT_WORKFORCE_DATA the same way.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reporthook-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const reporthook = require('./reporthook');
const accounts = require('./accounts');

const SCRIPT = path.join(SANDBOX, 'kosmos-report-hook.sh');
fs.writeFileSync(SCRIPT, '#!/bin/bash\nexit 0\n', { mode: 0o755 });

let n = 0;
const fresh = () => path.join(fs.mkdtempSync(path.join(SANDBOX, 'case-')), `settings${n++}.json`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const oursIn = (data, event) => (data.hooks[event] || []).filter(reporthook.entryIsOurs).length;

test('an absent settings.json is born with all seven events wired', () => {
  const p = fresh();
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, true);
  assert.equal(got.changed, true);
  const data = readJson(p);
  for (const ev of reporthook.HOOK_EVENTS) {
    assert.equal(oursIn(data, ev), 1, ev + ' is not wired');
  }
});

test('merge, never clobber: existing settings and existing hooks survive untouched', () => {
  const p = fresh();
  fs.writeFileSync(p, JSON.stringify({
    model: 'opus',
    permissions: { allow: ['Bash(git *)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash somebody-elses-gate.sh' }] }] },
  }));
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, true);
  const data = readJson(p);
  assert.equal(data.model, 'opus');
  assert.deepEqual(data.permissions.allow, ['Bash(git *)']);
  assert.equal(data.hooks.PreToolUse[0].hooks[0].command, 'bash somebody-elses-gate.sh',
    'the pre-existing hook was displaced rather than kept first');
  assert.equal(oursIn(data, 'PreToolUse'), 1);
});

test('idempotent: a second call changes nothing and doubles nothing', () => {
  const p = fresh();
  reporthook.ensureWired(p, SCRIPT);
  const again = reporthook.ensureWired(p, SCRIPT);
  assert.equal(again.wired, true);
  assert.equal(again.changed, false);
  const data = readJson(p);
  for (const ev of reporthook.HOOK_EVENTS) assert.equal(oursIn(data, ev), 1, ev + ' is doubled');
});

test('a partial wiring is completed, not restarted: hand-installed events keep their one entry', () => {
  const p = fresh();
  fs.writeFileSync(p, JSON.stringify({
    hooks: { SessionStart: [reporthook.entryFor('/some/older/path/kosmos-report-hook.sh')] },
  }));
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.changed, true);
  const data = readJson(p);
  assert.equal(oursIn(data, 'SessionStart'), 1, 'the hand-installed entry was doubled');
  assert.match(data.hooks.SessionStart[0].hooks[0].command, /older/, 'the hand-installed entry was replaced');
  assert.equal(oursIn(data, 'SessionEnd'), 1, 'the missing events were not completed');
});

test('an unparseable settings file is left alone, with a sentence', () => {
  const p = fresh();
  fs.writeFileSync(p, '{ this is not json');
  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, false);
  assert.match(got.because, /left alone/);
  assert.equal(fs.readFileSync(p, 'utf8'), '{ this is not json', 'the file was touched anyway');
});

test('a tightened file mode survives the merge: 0600 stays 0600', () => {
  const p = fresh();
  fs.writeFileSync(p, '{}', { mode: 0o600 });
  reporthook.ensureWired(p, SCRIPT);
  assert.equal(fs.statSync(p).mode & 0o7777, 0o600);
});

test('no script on the machine refuses in a sentence rather than wiring a command that cannot run', () => {
  const got = reporthook.ensureWired(fresh(), null);
  assert.equal(got.wired, false);
  assert.match(got.because, /not on this machine/);
});

test('accounts.prepare births an account with its hooks wired, and says so', () => {
  const got = accounts.prepare('hooktest');
  assert.equal(got.ok, true);
  assert.equal(got.hooksWired, true, 'prepare did not report the wiring: ' + JSON.stringify(got));
  const data = readJson(path.join(got.dir, 'settings.json'));
  for (const ev of reporthook.HOOK_EVENTS) assert.equal(oursIn(data, ev), 1, ev + ' missing from the born account');
});

test('prepare on a dir that already has settings keeps them: the merge posture holds at birth too', () => {
  const dir = path.join(SANDBOX, '.claude-keepme');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'sonnet' }));
  const got = accounts.prepare('keepme');
  assert.equal(got.ok, true);
  const data = readJson(path.join(dir, 'settings.json'));
  assert.equal(data.model, 'sonnet', 'prepare clobbered a real settings file');
  assert.equal(oursIn(data, 'SessionStart'), 1);
});

test('hookScriptPath finds the source-checkout script from the engine directory', () => {
  const found = reporthook.hookScriptPath();
  assert.ok(found && found.endsWith('kosmos-report-hook.sh'),
    'the probe found nothing; the script beside install/kosmos is missing');
  assert.ok(fs.existsSync(found));
});
