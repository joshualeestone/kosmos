'use strict';

/* #6071: PostToolUseFailure is wired only for a Claude Code that knows it (2.1.0+). A Claude Code before 2.1.0
   validates `hooks` against its own event list and, on a failure, drops the WHOLE settings file, so an unknown or
   older version must never get the key. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reporthook-vg-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const reporthook = require('./reporthook');

const SCRIPT = path.join(SANDBOX, 'kosmos-report-hook.sh');
fs.writeFileSync(SCRIPT, '#!/bin/bash\nexit 0\n', { mode: 0o755 });
let n = 0;
const fresh = () => path.join(fs.mkdtempSync(path.join(SANDBOX, 'case-')), `settings${n++}.json`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const oursIn = (data, event) => ((data.hooks || {})[event] || []).filter(reporthook.entryIsOurs).length;
const EV = 'PostToolUseFailure';

test('HOOK_EVENTS is the seven report events; PostToolUseFailure is versioned at 2.1.0', () => {
  assert.equal(reporthook.HOOK_EVENTS.length, 7);
  assert.ok(!reporthook.HOOK_EVENTS.includes(EV));
  assert.equal(reporthook.VERSIONED_EVENTS[EV], '2.1.0');
});

test('versionAtLeast compares numerically, and an unparseable side is false', () => {
  const at = reporthook.versionAtLeast;
  assert.equal(at('2.1.0', '2.1.0'), true);
  assert.equal(at('2.1.296', '2.1.0'), true);
  assert.equal(at('2.10.0', '2.9.9'), true);
  assert.equal(at('3.0.0', '2.1.0'), true);
  assert.equal(at('2.0.50', '2.1.0'), false);
  assert.equal(at('1.0.100', '2.1.0'), false);
  assert.equal(at(null, '2.1.0'), false);
  assert.equal(at('', '2.1.0'), false);
  assert.equal(at('latest', '2.1.0'), false);
});

for (const v of [undefined, null, 'garbage', '1.0.100', '2.0.50']) {
  test(`version ${JSON.stringify(v)}: a new settings file gets the seven and no ${EV} key`, () => {
    const p = fresh();
    const got = reporthook.ensureWired(p, SCRIPT, { claudeVersion: v });
    assert.equal(got.wired, true);
    const data = readJson(p);
    for (const ev of reporthook.HOOK_EVENTS) assert.equal(oursIn(data, ev), 1, ev + ' is not wired');
    assert.ok(!Object.prototype.hasOwnProperty.call(data.hooks, EV), `${EV} was written for ${v}`);
  });
}

for (const v of ['2.1.0', '2.1.296', '3.0.0']) {
  test(`version ${v}: ${EV} is wired with the seven`, () => {
    const p = fresh();
    reporthook.ensureWired(p, SCRIPT, { claudeVersion: v });
    const data = readJson(p);
    for (const ev of reporthook.eventsFor(v)) assert.equal(oursIn(data, ev), 1, ev + ' is not wired');
    assert.equal(oursIn(data, EV), 1);
  });
}

test('an already wired file: unknown version leaves an existing entry untouched and writes nothing', () => {
  const p = fresh();
  reporthook.ensureWired(p, SCRIPT, { claudeVersion: '2.1.296' });
  const before = fs.readFileSync(p, 'utf8');
  const got = reporthook.ensureWired(p, SCRIPT, { claudeVersion: null });
  assert.equal(got.changed, false);
  assert.equal(fs.readFileSync(p, 'utf8'), before);
});

test('an older known version takes OUR entry back out and keeps a person\'s own entry for the event', () => {
  const p = fresh();
  reporthook.ensureWired(p, SCRIPT, { claudeVersion: '2.1.296' });
  const data = readJson(p);
  const theirs = { hooks: [{ type: 'command', command: 'bash their-own.sh' }] };
  data.hooks[EV].push(theirs);
  data.model = 'opus';
  fs.writeFileSync(p, JSON.stringify(data));
  const got = reporthook.ensureWired(p, SCRIPT, { claudeVersion: '2.0.50' });
  assert.equal(got.changed, true);
  const after = readJson(p);
  assert.equal(oursIn(after, EV), 0);
  assert.deepEqual(after.hooks[EV], [theirs]);
  assert.equal(after.model, 'opus');
  for (const ev of reporthook.HOOK_EVENTS) assert.equal(oursIn(after, ev), 1, ev + ' lost');
});

test('an older known version with only our entry removes the event key entirely', () => {
  const p = fresh();
  reporthook.ensureWired(p, SCRIPT, { claudeVersion: '2.1.0' });
  reporthook.ensureWired(p, SCRIPT, { claudeVersion: '1.0.100' });
  assert.ok(!Object.prototype.hasOwnProperty.call(readJson(p).hooks, EV));
});

test('claudeVersion reads the version a program prints, and answers null for a missing or failing program', () => {
  /* node stands in for claude: `node --version` prints "v22.x.y", the same dotted triple `claude --version` leads
     with, and it runs on every host this suite does. */
  assert.equal(reporthook.claudeVersion(process.execPath), process.versions.node);
  assert.equal(reporthook.claudeVersion(SANDBOX), null, 'a folder is not a program');
  assert.equal(reporthook.claudeVersion(path.join(SANDBOX, 'nope')), null);
  assert.equal(reporthook.claudeVersion(null), null);
});

test('accounts.prepare with no claude on the machine is born without the versioned event', () => {
  const accounts = require('./accounts');
  const got = accounts.prepare('vg6071');
  assert.equal(got.ok, true);
  const data = readJson(path.join(got.dir, 'settings.json'));
  assert.ok(!Object.prototype.hasOwnProperty.call(data.hooks, EV));
  for (const ev of reporthook.HOOK_EVENTS) assert.equal(oursIn(data, ev), 1, ev + ' missing');
});
