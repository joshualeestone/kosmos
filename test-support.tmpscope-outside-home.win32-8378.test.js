'use strict';
/*
 * kosmos#8378: test-support/tmpscope-outside-home.js makes a test's temp scope outside the person's home on Windows, so
 * the token-only guard's ancestor walk never reads the real ~/.claude/CLAUDE.md and its imports. The choice of folder is
 * checked through its seams, and the second arm runs it for real in a child process. Both run on Windows only: the
 * folders are Windows drive paths, which the host path functions read as such only there.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { outsideHomeRoot } = require('./test-support/tmpscope-outside-home');

const WIN = process.platform === 'win32';
const W = path.win32;
const HELPER = path.join(__dirname, 'test-support', 'tmpscope-outside-home.js');
const base = { platform: 'win32', tmp: 'C:\\Users\\p\\AppData\\Local\\Temp', home: 'C:\\Users\\p', env: { SystemRoot: 'C:\\Windows' }, exists: () => false, canMake: () => true };

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
  assert.equal(outsideHomeRoot({ ...base, exists: (p) => p === 'C:\\Windows\\Temp\\other.md' }), W.join('C:\\Windows', 'Temp'), 'CONTROL: another file there changes nothing');
});

test('on Windows the scope it makes is outside the home, holds the fixtures, and is gone after exit', { skip: !WIN && 'about where os.tmpdir() points on Windows, inside the home' }, () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const code = `const t = require(${JSON.stringify(HELPER)}); const os = require('os'); const fs = require('fs');
const d = fs.mkdtempSync(require('path').join(os.tmpdir(), 'x-'));
process.stdout.write(JSON.stringify({ scope: t.scopeDir(), moved: t.movedTo(), tmp: os.tmpdir(), made: d }))`;
  const r = JSON.parse(execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }).trim());
  const inHome = (p) => path.resolve(p).toLowerCase().startsWith(os.homedir().toLowerCase() + path.sep);
  assert.ok(r.moved, 'the scope was not moved out of the home');
  assert.equal(inHome(r.scope), false, 'the scope is still inside the home: ' + r.scope);
  assert.equal(r.tmp, r.scope, 'os.tmpdir() is not the scope');
  assert.ok(r.made.startsWith(r.scope + path.sep), 'a fixture landed outside the scope: ' + r.made);
  assert.equal(fs.existsSync(r.scope), false, 'the scope was left behind after the process ended');
});
