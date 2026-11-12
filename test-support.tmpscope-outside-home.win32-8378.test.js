'use strict';
/*
 * kosmos#8378: test-support/tmpscope-outside-home.js makes a test's temp scope outside the person's home on Windows, so
 * the token-only guard's ancestor walk never reads the real ~/.claude/CLAUDE.md and its imports. The choice of folder is
 * checked through its seams (the GitHub runner's short 8.3 TEMP among them); the other arms run it for real in child
 * processes. All run on Windows only: the folders are Windows drive paths, which the host path functions read as such
 * only there.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { outsideHomeRoot, outsideHomeChoice } = require('./test-support/tmpscope-outside-home');

const WIN = process.platform === 'win32';
const W = path.win32;
const HELPER = path.join(__dirname, 'test-support', 'tmpscope-outside-home.js');
const base = { platform: 'win32', tmp: 'C:\\Users\\p\\AppData\\Local\\Temp', home: 'C:\\Users\\p', env: { SystemRoot: 'C:\\Windows' }, exists: () => false, canMake: () => true, real: (p) => W.resolve(p) };

test('the system temp folder is chosen only on Windows, only when the temp folder is inside the home', { skip: !WIN && 'its folder checks use the host path functions, which read a Windows drive path only on Windows' }, () => {
  assert.equal(outsideHomeRoot(base), W.join('C:\\Windows', 'Temp'));
  assert.equal(outsideHomeRoot({ ...base, platform: 'darwin' }), null, 'off Windows nothing moves');
  assert.equal(outsideHomeRoot({ ...base, tmp: 'D:\\tmp' }), null, 'a temp folder outside the home is left alone');
  assert.equal(outsideHomeRoot({ ...base, env: {} }), null, 'no system folder named: nothing moves');
  assert.equal(outsideHomeRoot({ ...base, canMake: () => false }), null, 'a folder that cannot be made in is not used');
  // An instruction file in the chosen folder or any folder above it would be read by the guard, so that place is refused.
  for (const at of ['C:\\Windows\\Temp\\CLAUDE.md', 'C:\\Windows\\AGENTS.md', 'C:\\.claude']) {
    assert.equal(outsideHomeRoot({ ...base, exists: (p) => p.toLowerCase() === at.toLowerCase() }), null, at);
  }
  assert.equal(outsideHomeRoot({ ...base, exists: (p) => p === 'C:\\Windows\\CLAUDE.txt' }), W.join('C:\\Windows', 'Temp'), 'CONTROL: a file in a place it looks, but not an instruction name, changes nothing');
});

test('the temp folder and the home are compared by their real paths, so a short 8.3 TEMP inside the home is seen (the GitHub runner)', { skip: !WIN && 'its folder checks use the host path functions, which read a Windows drive path only on Windows' }, () => {
  // windows-latest: TEMP is C:\Users\RUNNER~1\AppData\Local\Temp, os.homedir() is C:\Users\runneradmin.
  const runner = { ...base, tmp: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp', home: 'C:\\Users\\runneradmin' };
  const long = (p) => W.resolve(p).replace(/^C:\\Users\\RUNNER~1(?=\\|$)/i, 'C:\\Users\\runneradmin');
  const c = outsideHomeChoice({ ...runner, real: long });
  assert.equal(c.inHome, true, 'the short TEMP was not seen inside the home');
  assert.equal(c.root, W.join('C:\\Windows', 'Temp'));
  // CONTROL: compared as written (no real path), the two spellings do not match, which is the bug this arm guards.
  assert.equal(outsideHomeChoice({ ...runner }).inHome, false, 'CONTROL: the plain strings matched, so this arm cannot see the bug');
  assert.equal(outsideHomeChoice({ ...base, tmp: 'C:\\USERS\\P\\appdata\\local\\temp' }).inHome, true, 'the comparison is case-blind');
});

/* Run the helper in a child process and report what it decided and where the fixtures went. sysRoot, when given, is
   set inside the child before the helper loads: node itself needs the real SystemRoot to start on Windows. */
function runHelper(sysRoot) {
  const pre = sysRoot ? `process.env.SystemRoot = ${JSON.stringify(sysRoot)}; process.env.windir = ${JSON.stringify(sysRoot)};` : '';
  const code = `${pre} const t = require(${JSON.stringify(HELPER)}); const os = require('os'); const fs = require('fs');
const d = fs.mkdtempSync(require('path').join(os.tmpdir(), 'x-'));
process.stdout.write(JSON.stringify({ choice: t.choice(), scope: t.scopeDir(), moved: t.movedTo(), tmp: os.tmpdir(), made: d }))`;
  const r = require('node:child_process').spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { ...JSON.parse(r.stdout.trim()), stderr: r.stderr };
}

test('on Windows the scope follows what the helper decides for this host: moved out of the home, or left with its reason', { skip: !WIN && 'about where os.tmpdir() points on Windows' }, (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const r = runHelper();
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const home = real(os.homedir()).toLowerCase() + path.sep;
  const inHome = (p) => real(p).toLowerCase().startsWith(home);
  assert.ok(r.choice, 'the helper made no decision');
  assert.equal(r.tmp, r.scope, 'os.tmpdir() is not the scope');
  assert.ok(r.made.startsWith(r.scope + path.sep), 'a fixture landed outside the scope: ' + r.made);
  assert.equal(fs.existsSync(r.scope), false, 'the scope was left behind after the process ended');
  if (!r.choice.inHome) {
    assert.equal(r.moved, null, 'a temp folder outside the home was moved anyway');
    assert.equal(r.stderr, '', 'a host with nothing to move said something');
    t.skip('this host keeps its temp folder outside the home, so there is nothing to move');
    return;
  }
  if (!r.choice.root) {
    assert.equal(r.moved, null);
    assert.match(r.stderr, /the temp folder stays inside the home/, 'a refusal was not said on stderr');
    t.skip('the system temp folder cannot be used on this host: ' + r.choice.why);
    return;
  }
  assert.equal(r.moved, r.choice.root);
  assert.equal(inHome(r.scope), false, 'the scope is still inside the home: ' + r.scope);
  assert.equal(r.stderr, '', 'a move said something on stderr');
});

test('on Windows a refused move is said on stderr, with why', { skip: !WIN && 'about the Windows system temp folder' }, (t) => {
  // The system folder named inside the home (this file's own scope is there when TEMP is), so the helper refuses it.
  const os = require('node:os');
  const fs = require('node:fs');
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'sysroot-'));
  const r = runHelper(sys);
  if (!r.choice.inHome) { assert.equal(r.stderr, '', 'CONTROL: nothing to move, nothing said'); t.skip('the temp folder here is outside the home, so no move can be refused'); return; }
  assert.equal(r.moved, null, 'a system folder inside the home was used');
  assert.match(r.stderr, /the temp folder stays inside the home/);
  assert.match(r.stderr, /is inside the home too/, 'the reason was not said');
});

test('realOrResolved spells a path that does not exist yet by its long name, through its deepest existing folder', { skip: process.platform !== 'win32' && 'about short 8.3 names on Windows' }, (t) => {
  const { realOrResolved } = require('./test-support/tmpscope-outside-home');
  const fs = require('node:fs');
  let long;
  try { long = fs.realpathSync.native('C:/PROGRA~1'); } catch { long = null; }
  if (!long || /PROGRA~1/i.test(long)) { t.skip('8.3 names are off on C: here'); return; }
  // Review round 2: on the runner TEMP is spelled short (RUNNER~1); a folder under it not made yet must still compare long.
  assert.equal(realOrResolved('C:/PROGRA~1/no-such-8378/x').toLowerCase(), require('node:path').join(long, 'no-such-8378', 'x').toLowerCase());
});

test('review round 3: a temp folder written inside the home counts as inside even when its real path is elsewhere (a junction)', { skip: process.platform !== 'win32' && 'about Windows paths' }, () => {
  const { outsideHomeChoice } = require('./test-support/tmpscope-outside-home');
  // The guard walks the written chain as well as the real one, so the written spelling alone puts the home in its walk.
  const real = (p) => (p.split(require('node:path').sep).join('/').toLowerCase().startsWith('c:/users/x/appdata/local/temp') ? 'D:/elsewhere/temp' : p);
  const c = outsideHomeChoice({ platform: 'win32', tmp: 'C:/Users/x/AppData/Local/Temp', home: 'C:/Users/x',
    env: { SystemRoot: 'C:/Windows' }, exists: () => false, canMake: () => true, real });
  assert.equal(c.inHome, true, 'a temp folder written inside the home was treated as outside it');
  assert.ok(c.root, 'nothing moved: ' + c.why);
});
