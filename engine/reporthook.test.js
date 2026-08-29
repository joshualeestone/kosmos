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

test('a script path carrying shell-special characters is refused, not embedded in a command', () => {
  const evil = path.join(SANDBOX, 'x"y', 'kosmos-report-hook.sh');
  const got = reporthook.ensureWired(fresh(), evil);
  assert.equal(got.wired, false);
  assert.match(got.because, /will not embed/);
});

// ---------------------------------------------------------------------------
// #561/#1467: an entry of ours pointing at the WRONG COPY is not "already wired"
// ---------------------------------------------------------------------------

/* 🛑 MEASURED ON THE REAL MACHINE, 2026-08-29. Seven live entries pointed at a
   hand-placed copy of the script in ~/.claude/hooks/user dated Aug 26, and
   `ensureWired` answered {wired: true, changed: false} against them: SUCCESS,
   having changed nothing, for a script it had never seen.

   `entryIsOurs` matches the FILENAME, and every copy of the script carries the
   filename. So the product's self-healing path could not heal the one thing it
   exists to heal, and reported that it had. `setup.sh` re-runs this on every
   update, which is why a stale hook survived all of them. */

const STALE = path.join(SANDBOX, 'elsewhere', 'kosmos-report-hook.sh');
const staleEntry = () => ({
  matcher: '',
  hooks: [{ type: 'command', command: 'bash "' + STALE + '"', timeout: 15 }],
});

test('#1467: an entry aimed at another copy of the script is REPOINTED, not skipped', () => {
  const p = fresh();
  const hooks = {};
  for (const e of reporthook.HOOK_EVENTS) hooks[e] = [staleEntry()];
  fs.writeFileSync(p, JSON.stringify({ hooks }));

  const got = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got.wired, true);
  assert.equal(got.changed, true, 'it reported success while changing nothing, which is the whole defect');

  const data = readJson(p);
  const all = JSON.stringify(data);
  assert.equal(all.includes(STALE), false, 'a stale copy is still wired, so an update cannot fix a machine');
  for (const e of reporthook.HOOK_EVENTS) {
    assert.equal(oursIn(data, e), 1, `event ${e} should carry exactly one entry of ours`);
    assert.equal(data.hooks[e][0].hooks[0].command.includes(SCRIPT), true, `event ${e} points at the wrong script`);
  }
});

test('#1467: repointing is IDEMPOTENT, so a second update is a no-op', () => {
  const p = fresh();
  const hooks = {};
  for (const e of reporthook.HOOK_EVENTS) hooks[e] = [staleEntry()];
  fs.writeFileSync(p, JSON.stringify({ hooks }));

  reporthook.ensureWired(p, SCRIPT);
  const after1 = fs.readFileSync(p, 'utf8');
  const got2 = reporthook.ensureWired(p, SCRIPT);
  assert.equal(got2.changed, false, 'a settings file already correct must not be rewritten');
  assert.equal(fs.readFileSync(p, 'utf8'), after1);
});

test('#1467 CONTROL: somebody else hook in the same event survives repointing', () => {
  // Without this, "replace our entries" could quietly become "replace the list".
  const p = fresh();
  const theirs = { matcher: '', hooks: [{ type: 'command', command: 'bash /somebody/else/thing.sh' }] };
  fs.writeFileSync(p, JSON.stringify({ hooks: { SessionStart: [theirs, staleEntry()] } }));

  reporthook.ensureWired(p, SCRIPT);
  const data = readJson(p);
  const cmds = data.hooks.SessionStart.map((e) => e.hooks[0].command);
  assert.equal(cmds.filter((c) => c.includes('/somebody/else/thing.sh')).length, 1,
    'a hook that is not ours was destroyed by repointing');
  assert.equal(cmds.some((c) => c.includes(SCRIPT)), true);
  assert.equal(cmds.some((c) => c.includes(STALE)), false);
});
