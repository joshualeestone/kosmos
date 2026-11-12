'use strict';
/*
 * kosmos#8378: on Windows the per-process temp scope (#4273, test-support/tmpscope.js) must actually move
 * os.tmpdir(), which reads TEMP and TMP there, not TMPDIR. Before this, the scope did nothing on Windows and test
 * fixtures piled up in the real %TEMP%. Run in child processes so this file's own temp folder is not the one tested.
 */
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

test('CONTROL: on Windows, TMPDIR alone does not move os.tmpdir() (why the scope sets TEMP and TMP)', { skip: !WIN && 'about how os.tmpdir() reads TEMP and TMP on Windows' }, () => {
  const r = child('process.stdout.write(JSON.stringify({ tmp: require("os").tmpdir() }))', { TMPDIR: path.join(__dirname, 'no-such-tmpdir-8378') });
  assert.notEqual(r.tmp, path.join(__dirname, 'no-such-tmpdir-8378'), 'TMPDIR moved os.tmpdir() on this Windows node; the TEMP/TMP setting may be unneeded');
});
