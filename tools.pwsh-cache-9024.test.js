'use strict';
/* #9024: node tests that start a real pwsh off Windows give it a startup cache of its own (test-support/pwsh.js), so a
 * damaged shared ~/.cache/powershell profile, or two validations writing it at once, cannot reach them; and a pwsh that
 * is here but cannot start fails with "pwsh broken on this machine (startup cache?)", never as a parse failure or a
 * quiet skip. #6352 did the same for shell tests (tools.pwsh-cache-6352.test.js).
 *
 * The sweep: every *.test.js that names pwsh as a program and loads child_process is listed below, either as one that
 * uses the helper (or sets XDG_CACHE_HOME itself) or with the reason it starts no pwsh off Windows. A new file is a
 * failure until it is put in one list, which is the point: it cannot be forgotten. Found by the literal 'pwsh' (or
 * bin/pwsh) only; a test that builds the name some other way is not seen.
 *   node --test tools.pwsh-cache-9024.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pwshEnv, pwshState, BROKEN } = require('./test-support/pwsh');

/* Each file's child_process calls and its pwshEnv( calls, counted in code with comments taken out. A new spawn, or a
   start that loses its pwshEnv, changes a count and fails here, so the file is looked at again. */
const OWN = {
  'engine/delete-leftover.win32-recyclebin-7820.test.js': { calls: 2, pwshEnv: 2 },   // both parse runs
  'engine/win32-psquote-8213.test.js': { calls: 2, pwshEnv: 1 },   // run(); the other is has('powershell.exe'), Windows only
  'tools.win-publish-node-sigwhy-8316.test.js': { calls: 1, pwshEnv: 1 },   // run()
  'tools.win-publish-node-bounded-7951.test.js': { calls: 5, pwshEnv: 0, xdg: 1 },   // its own PS_ENV (#6352's era); one call is `ps`
};
const USES_OWN_CACHE = Object.keys(OWN);
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const count = (s, re) => (s.match(re) || []).length;
const NO_PWSH_OFF_WINDOWS = {
  'engine/allowance.win32-6213.test.js': 'its pwsh arm runs only on Windows',
  'tools.win-publish-node-runtime-8285.test.js': 'RUNTIMES is empty off Windows',
  'tools.win-setup-ps1.test.js': 'hasPwsh() is false off Windows',
  'test-support.tool-guard-4326.test.js': 'pwsh is text inside a guarded fixture, never started',
  'tools.command-words-7262.test.js': 'pwsh is a word in a command line under test, never started',
  'tools.pwsh-cache-9024.test.js': 'this sweep: it starts only stand-in pwsh scripts it writes',
};

function testFiles() {
  const out = [];
  for (const dir of ['.', 'engine']) {
    for (const f of fs.readdirSync(path.join(__dirname, dir))) if (f.endsWith('.test.js')) out.push(dir === '.' ? f : dir + '/' + f);
  }
  return out;
}
const NAMES_PWSH = /['"/]pwsh['"]|bin\/pwsh/;
const found = testFiles().filter((f) => {
  const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
  return NAMES_PWSH.test(s) && s.includes('child_process');
});

test('#9024: the sweep finds the node tests known to start pwsh (so it checks something)', () => {
  for (const f of USES_OWN_CACHE) assert.ok(found.includes(f), f + ' was not found by the sweep: re-anchor NAMES_PWSH');
});

test('#9024: every node test that names pwsh is classified', () => {
  const unclassified = found.filter((f) => !USES_OWN_CACHE.includes(f) && !(f in NO_PWSH_OFF_WINDOWS));
  assert.deepEqual(unclassified, [], 'starts pwsh off Windows? use test-support/pwsh.js and list it in USES_OWN_CACHE; if not, say why in NO_PWSH_OFF_WINDOWS');
});

for (const f of USES_OWN_CACHE) {
  test('#9024: ' + f + ' gives pwsh its own cache', () => {
    const s = strip(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    const got = { calls: count(s, /\b(execFileSync|spawnSync|spawn|execFile|execSync)\(/g), pwshEnv: count(s, /\bpwshEnv\(/g) };
    if ('xdg' in OWN[f]) got.xdg = count(s, /XDG_CACHE_HOME/g);
    assert.deepEqual(got, OWN[f], f + ' changed how it starts programs: does every pwsh start still use pwshEnv? then update OWN');
  });
}

test('#9024 pwshEnv sets a cache folder of its own off Windows, keeps what it is given, and is the same folder each call', { skip: process.platform === 'win32' && 'the profile lives under LOCALAPPDATA there' }, () => {
  const a = pwshEnv({ K9024: 'x' });
  assert.equal(a.K9024, 'x');
  assert.ok(a.XDG_CACHE_HOME && fs.statSync(a.XDG_CACHE_HOME).isDirectory(), 'no cache folder');
  assert.notEqual(a.XDG_CACHE_HOME, process.env.XDG_CACHE_HOME);
  assert.equal(pwshEnv().XDG_CACHE_HOME, a.XDG_CACHE_HOME);
  assert.equal(pwshEnv({ XDG_CACHE_HOME: '/elsewhere' }).XDG_CACHE_HOME, a.XDG_CACHE_HOME, 'a caller cannot hand it the shared one back');
});

test('#9024 pwshState tells missing from broken, and broken says so', { skip: process.platform === 'win32' && 'the stand-in pwsh is a shell script' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-9024-'));
  try {
    assert.equal(pwshState(path.join(dir, 'no-such-pwsh')), 'missing');
    const crash = path.join(dir, 'pwsh-crash');
    fs.writeFileSync(crash, '#!/bin/sh\necho "Unhandled exception. System.IO.FileLoadException: The given assembly name was invalid." >&2\nkill -ABRT $$\n', { mode: 0o755 });
    const said = pwshState(crash);
    assert.ok(said.startsWith(BROKEN), said);
    assert.match(said, /SIGABRT/);
    assert.match(said, /FileLoadException/);
    assert.match(said, /never delete it/);
    const wrong = path.join(dir, 'pwsh-wrong');
    fs.writeFileSync(wrong, '#!/bin/sh\necho 3\n', { mode: 0o755 });
    assert.ok(pwshState(wrong).startsWith(BROKEN), 'a pwsh that answers 1+1 wrongly passed');
    const fine = path.join(dir, 'pwsh-fine');
    fs.writeFileSync(fine, '#!/bin/sh\n[ -n "$XDG_CACHE_HOME" ] && [ "$XDG_CACHE_HOME" != "$HOME/.cache" ] && echo 2\n', { mode: 0o755 });
    assert.equal(pwshState(fine), 'ok', 'the smoke check itself did not run with its own cache');
    const slow = path.join(dir, 'pwsh-slow');
    fs.writeFileSync(slow, '#!/bin/sh\nexec sleep 5\n', { mode: 0o755 });
    const late = pwshState(slow, 500);
    assert.match(late, /did not answer 1\+1 within 1 s on this machine \(busy\?\)/, late);
    assert.ok(!late.startsWith(BROKEN), 'a busy machine was blamed on the startup cache');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
