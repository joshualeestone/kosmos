'use strict';
/**
 * kosmos#3628: the CLI test harnesses turned a killed or unspawnable CLI into an exit code.
 *
 * Ten cli.*.test.js files mapped execFile's error with a numeric-or-<0> fallback, five more
 * (plus cli.project-create-3388's catch) with a <1> fallback, and cli.world-outbox-1704
 * with <-1>. When execFile's `timeout`
 * fires it kills the child and reports err.code = null, err.signal = 'SIGTERM'; a spawn
 * failure reports err.code = 'ENOENT', a string. So a timed-out run read as 0 (a PASS for a
 * test expecting success) or as 1 (a PASS for a test expecting failure).
 *
 * Mapping the missing code to some other value does not work: a labelled string passes
 * `assert.notEqual(code, 0)`, so a killed CLI would still satisfy "it failed" (shown below).
 * So every harness now REJECTS when there is no numeric exit code, and the test fails with
 * "the CLI gave no exit code (SIGTERM)", whatever it asserts.
 *
 * This file proves that shape on a real killed process, a real spawn failure and real exit
 * codes, and guards the class: no test file may default a missing exit code to a number.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

// The harness shape every cli.*.test.js now uses, reduced to its exit-code handling.
function harness(file, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout or never started. ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '' });
    });
  });
}

test('#3628: a CLI killed by the harness timeout fails the test instead of returning a code', async () => {
  await assert.rejects(harness('/bin/sh', ['-c', 'sleep 5'], { timeout: 200 }), /no exit code \(SIGTERM\)/);
});

test('#3628: a CLI that cannot be spawned fails the test instead of returning a code', async () => {
  await assert.rejects(harness(path.join(__dirname, 'no-such-cli-3628'), [], {}), /no exit code \(ENOENT\)/);
});

test('#3628: real exit codes and success still come through', async () => {
  assert.equal((await harness('/bin/sh', ['-c', 'exit 3'], {})).code, 3);
  assert.equal((await harness('/bin/sh', ['-c', 'echo hi; exit 0'], {})).code, 0);
});

test('#3628 CONTRAST: why the harness rejects rather than returning a sentinel', async () => {
  const err = await new Promise((r) => execFile('/bin/sh', ['-c', 'sleep 5'], { timeout: 200 }, (e) => r(e)));
  assert.equal(err.code, null);
  const ZERO = 0, ONE = 1;
  const oldZero = err && typeof err.code === 'number' ? err.code : ZERO;
  const oldOne = err ? (err.code ?? ONE) : ZERO;
  const sentinel = 'no exit code (' + err.signal + ')';
  assert.equal(oldZero, 0, 'a kill read as success');
  assert.equal(oldOne, 1, 'a kill read as a clean failure');
  assert.notEqual(sentinel, 0, 'a sentinel still satisfies "it failed" assertions, so it is not enough');
});

test('#3628: no test file defaults a missing exit code to a number', () => {
  // Any numeric fallback for a missing code (0, 1, -1, ...): `typeof x.code === 'number'
  // ? x.code : 0`, `x.code ?? 1`, `x.code || -1` (x = err, e or error). Every sentinel
  // has the notEqual(code, 0) flaw, so none is allowed.
  const UNSAFE = /typeof (err|e|error)\.code === 'number'\s*\)?\s*\?\s*\1\.code\s*:\s*-?\d+\b|\b(?:err|e|error)\.code\s*(?:\?\?|\|\|)\s*-?\d+\b/;
  // `err ? err.code : 0` is safe ONLY after the reject line: alone, a kill gives null,
  // which passes notEqual(code, 0) just like a sentinel would.
  const BARE = /\berr \? err\.code : 0\b/;
  const REJECTS = 'the CLI gave no exit code (';
  // Positive controls: the pattern matches every spelling it guards against.
  const Z = '0', O = '1';
  for (const sample of [
    "err && typeof err.code === 'number' ? err.code : " + Z,
    'err ? (err.code ?? ' + O + ') : 0',
    "(e && typeof e.code === 'number') ? e.code : " + O,
    'error.code || ' + Z,
    "err ? (typeof err.code === 'number' ? err.code : -" + O + ') : 0',
  ]) assert.match(sample, UNSAFE, sample);
  // Negative control: the guarded harness form is not flagged by UNSAFE.
  assert.doesNotMatch('resolve({ code: err ? err.code : ' + Z + ', stdout });', UNSAFE);
  const dirs = [__dirname, path.join(__dirname, 'engine')];
  const files = [];
  for (const d of dirs) for (const f of fs.readdirSync(d)) if (f.endsWith('.test.js')) files.push(path.join(d, f));
  const self = path.join(__dirname, 'cli.exit-code-mapping-3628.test.js');
  let guarded = 0;
  const bad = [];
  for (const f of files) {
    if (f === self) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (UNSAFE.test(src)) bad.push(path.relative(__dirname, f));
    if (BARE.test(src) && !src.includes(REJECTS)) bad.push(path.relative(__dirname, f) + ' (err.code without the reject line)');
    if (src.includes(REJECTS)) guarded++;
  }
  assert.deepEqual(bad, [], 'these files default a missing exit code to a number');
  // The scan must actually reach the harnesses it protects (17 at the time of writing).
  assert.ok(guarded >= 17, 'only ' + guarded + ' test files reject a missing exit code; the scan may be looking in the wrong place');
});
