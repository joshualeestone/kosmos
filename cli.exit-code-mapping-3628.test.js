'use strict';
/**
 * kosmos#3628: the CLI test harnesses turned a killed or unspawnable CLI into exit 0.
 *
 * They mapped execFile's callback error to an exit code with (spelled here with <0> so
 * the guard at the bottom does not match this comment)
 *   err && typeof err.code === 'number' ? err.code : <0>
 * When execFile's `timeout` fires it kills the child and reports err.code = null with
 * err.signal = 'SIGTERM', so a timed-out run read as exit 0: a PASS for any test that
 * expects success. A spawn failure (err.code = 'ENOENT', a string) read as 0 the same way.
 * Twelve copies in eleven cli.*.test.js files carried it.
 *
 * The harnesses now use
 *   err ? (typeof err.code === 'number' ? err.code : 'no exit code (' + (err.signal || err.code) + ')') : 0
 * which can never equal a numeric expected code. This file proves that on a real killed
 * process and a real spawn failure (with the old form as the contrast, so the tests can
 * tell the two apart), and guards the class: no test file may bring the old form back.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ZERO = 0; // keeps the old form below from matching the guard's own pattern
const oldMap = (err) => (err && typeof err.code === 'number' ? err.code : ZERO);
const newMap = (err) => (err ? (typeof err.code === 'number' ? err.code : 'no exit code (' + (err.signal || err.code) + ')') : 0);

const run = (file, args, opts) => new Promise((resolve) => {
  execFile(file, args, opts, (err) => resolve(err));
});

test('#3628: a CLI killed by the harness timeout does not read as exit 0', async () => {
  const err = await run('/bin/sh', ['-c', 'sleep 5'], { timeout: 200 });
  assert.ok(err, 'the stub was not killed; the control did not exercise a timeout');
  assert.equal(err.code, null);
  assert.equal(err.signal, 'SIGTERM');
  assert.equal(oldMap(err), 0, 'contrast: the old mapping should read the kill as 0');
  assert.notEqual(newMap(err), 0);
  assert.equal(newMap(err), 'no exit code (SIGTERM)');
});

test('#3628: a CLI that cannot be spawned does not read as exit 0', async () => {
  const err = await run(path.join(__dirname, 'no-such-cli-3628'), [], {});
  assert.ok(err);
  assert.equal(err.code, 'ENOENT');
  assert.equal(oldMap(err), 0, 'contrast: the old mapping should read ENOENT as 0');
  assert.equal(newMap(err), 'no exit code (ENOENT)');
});

test('#3628: real exit codes and success still map as before', async () => {
  assert.equal(newMap(await run('/bin/sh', ['-c', 'exit 3'], {})), 3);
  assert.equal(newMap(await run('/bin/sh', ['-c', 'exit 0'], {})), 0);
});

test('#3628: no test file maps a missing exit code to 0', () => {
  const UNSAFE = /typeof err\.code === 'number' \? err\.code : 0\b/;
  // Positive control: the pattern matches the form it is guarding against.
  assert.match("resolve({ code: err && typeof err.code === 'number' ? err.code : " + '0, stdout });', UNSAFE);
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js'));
  let safe = 0;
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    if (UNSAFE.test(src)) bad.push(f);
    if (src.includes("'no exit code (' + (err.signal || err.code) + ')'")) safe++;
  }
  assert.deepEqual(bad, [], 'these files read a killed or unspawnable CLI as exit 0');
  // The scan must actually have reached the harnesses it protects.
  assert.ok(safe >= 10, 'only ' + safe + ' test files use the safe mapping; the scan may be looking in the wrong place');
});
