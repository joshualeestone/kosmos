'use strict';
/*
 * kosmos#8378: on Windows the per-process temp scope (#4273, test-support/tmpscope.js) must actually move
 * os.tmpdir(), which reads TEMP and TMP there, not TMPDIR. Before this, the scope did nothing on Windows and test
 * fixtures piled up in the real %TEMP%. Run in child processes so this file's own temp folder is not the one tested.
 */
// kosmos#8378: the box's own TEMP and TMP, read before this file's scope replaces them (the long-form arm below hands them to a child).
const BOX_TEMP = process.env.TEMP;
const BOX_TMP = process.env.TMP;
require('./test-support/tmpscope');   // this file's own scope, so a child's kts- folder left by a failing run stays inside it
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WIN = process.platform === 'win32';
const SCOPE = path.join(__dirname, 'test-support', 'tmpscope.js');

function child(code, env) {
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim());
}

test('on Windows, requiring tmpscope moves os.tmpdir() into its own kts- folder, and the folder is gone after exit', { skip: !WIN && 'about how os.tmpdir() reads TEMP and TMP on Windows' }, () => {
  const fs = require('node:fs');
  const r = child(`require(${JSON.stringify(SCOPE)}); const os = require('os'); const fs = require('fs'); const d = fs.mkdtempSync(require('path').join(os.tmpdir(), 'x-')); process.stdout.write(JSON.stringify({ tmp: os.tmpdir(), made: d, temp: process.env.TEMP, tmpv: process.env.TMP }))`, {});
  assert.match(path.basename(r.tmp), /^kts-/, 'os.tmpdir() did not move into the scope: ' + r.tmp);
  assert.ok(r.made.startsWith(r.tmp + path.sep), 'a fixture made in the scope landed elsewhere: ' + r.made);
  assert.equal(r.temp, r.tmp, 'TEMP was not set to the scope (children would escape it)');
  assert.equal(r.tmpv, r.tmp, 'TMP was not set to the scope');
  assert.equal(fs.existsSync(r.tmp), false, 'the scope folder was left behind after the process ended');
});

test('on Windows the scope is named in its long form, as realpath names it, even when TEMP is an 8.3 short path', { skip: !WIN && 'about 8.3 short paths, which only Windows has' }, () => {
  const fs = require('node:fs');
  // GitHub's runner gives TEMP as C:\Users\RUNNER~1\...; the product resolves paths with realpath and gets
  // C:\Users\runneradmin\..., so a scope left short made a test's expected path differ from the product's answer.
  const r = child(`require(${JSON.stringify(SCOPE)}); const os = require('os'); const fs = require('fs'); process.stdout.write(JSON.stringify({ tmp: os.tmpdir(), native: fs.realpathSync.native(os.tmpdir()), temp: process.env.TEMP }))`, { TEMP: BOX_TEMP, TMP: BOX_TMP });
  assert.equal(r.tmp, r.native, 'the scope is not in its long form: ' + r.tmp + ' vs ' + r.native);
  assert.equal(r.temp, r.native, 'TEMP (what children see) is not the long form');
  // Whether this box's own TEMP is short decides whether the arm above could have failed here; say which.
  const outer = BOX_TEMP || BOX_TMP || '';
  let outerNative = outer; try { outerNative = fs.realpathSync.native(outer); } catch { /* keep */ }
  if (outer === outerNative) console.log('# note: this box gives TEMP in its long form already, so the arm above could not have failed here');
});

test('on Windows the sweep outlasts a child that holds a fixture as its working folder for a moment after exit', { skip: !WIN && 'about how Windows holds a folder a process is using' }, async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  // Outside the child's scope (in this file's own): the grandchild writes it as it starts, so a pass proves it ran (and so held
  // its working folder from its creation) rather than never starting.
  const started = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'started-')), 'started');
  // The test process spawns a detached grandchild whose working folder is a fixture in the scope; the grandchild lives
  // about 150 ms (plus its start; about 200 ms measured, against a retry budget of about 1.5 s) past the test process's exit, so a single rmSync at exit meets the hold (EBUSY/EPERM) and leaves it.
  const code = `require(${JSON.stringify(SCOPE)}); const os = require('os'); const fs = require('fs'); const path = require('path');
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'held-'));
const c = require('child_process').spawn(process.execPath, ['-e', 'require("fs").writeFileSync(process.env.STARTED_8378, "1"); setTimeout(() => {}, 150)'], { cwd: d, detached: true, stdio: 'ignore', env: { ...process.env, STARTED_8378: ${JSON.stringify(started)} } });
c.unref(); process.stdout.write(JSON.stringify({ tmp: os.tmpdir() }));`;
  const r = child(code, {});
  assert.match(path.basename(r.tmp), /^kts-/);
  // The sweep runs inside the child's exit, so its result is fixed before execFileSync returns; this wait only lets the
  // grandchild end before this test does.
  await new Promise((res) => setTimeout(res, 1000));
  assert.ok(fs.existsSync(started), 'the grandchild never ran, so nothing held the folder and this test proved nothing');
  assert.equal(fs.existsSync(r.tmp), false, 'the scope folder was left behind by a held working folder: ' + r.tmp);
});

test('CONTROL: on Windows, TMPDIR alone does not move os.tmpdir() (why the scope sets TEMP and TMP)', { skip: !WIN && 'about how os.tmpdir() reads TEMP and TMP on Windows' }, () => {
  const r = child('process.stdout.write(JSON.stringify({ tmp: require("os").tmpdir() }))', { TMPDIR: path.join(__dirname, 'no-such-tmpdir-8378') });
  assert.notEqual(r.tmp, path.join(__dirname, 'no-such-tmpdir-8378'), 'TMPDIR moved os.tmpdir() on this Windows node; the TEMP/TMP setting may be unneeded');
});
