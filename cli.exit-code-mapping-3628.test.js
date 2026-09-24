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
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '): killed by the harness timeout, over the output buffer, or never started. ' + (stderr || ''))); return; }
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

test('#3628: no test file reads a missing exit code as a number or null (the spellings below)', () => {
  // Any numeric fallback for a missing code (0, 1, -1, ...): `typeof x.code === 'number'
  // ? x.code : 0`, `x.code ?? 1`, `x.code || -1` (x = err, e or error). Every sentinel
  // has the notEqual(code, 0) flaw, so none is allowed.
  const UNSAFE = /typeof (err|e|error)\.code === 'number'\s*\)?\s*\?\s*\1\.code\s*:\s*-?\d+\b|\b(?:err|e|error)\??\.code\s*(?:\?\?|\|\|)\s*-?\d+\b/;
  // An exit code taken bare from an exec error (`code: err ? err.code ...`, `code: e && e.code`,
  // `const code = err ? err.code ...`) is safe ONLY right after a check that it is a
  // number: alone, a kill gives null, which passes notEqual(code, 0) just like a sentinel
  // would. Checked per call site, not per file. Scoped to a `code` key or variable and the
  // exec-error names, so typed-error checks (`e && e.code === 'ENOENT'`) and HTTP results
  // (`code: last && last.code`) are not exit codes and are not flagged.
  const BARE = /\bcode\s*[:=]\s*\(?\s*(err|e|error)\s*(?:\?|&&)\s*\1\.code\b/g;
  const bareUnchecked = (src) => [...src.matchAll(BARE)].filter((m) =>
    !src.slice(Math.max(0, m.index - 400), m.index).includes('typeof ' + m[1] + ".code !== 'number'"));
  const REJECTS = 'the CLI gave no exit code (';
  // Positive controls: the pattern matches every spelling it guards against.
  const Z = '0', O = '1';
  for (const sample of [
    "err && typeof err.code === 'number' ? err.code : " + Z,
    'err ? (err.code ?? ' + O + ') : 0',
    "(e && typeof e.code === 'number') ? e.code : " + O,
    'error.code || ' + Z,
    "err ? (typeof err.code === 'number' ? err.code : -" + O + ') : 0',
    'code: err?.code ?? ' + Z,
  ]) assert.match(sample, UNSAFE, sample);
  // Negative control: the guarded harness form is not flagged by UNSAFE.
  assert.doesNotMatch('resolve({ code: err ? err.code : ' + Z + ', stdout });', UNSAFE);
  // Per-site controls: each unguarded spelling is flagged, the guarded form is not, and a
  // guarded site does not vouch for a second unguarded one in the same file.
  for (const sample of ['code: err ? err.code : ' + Z, 'code: e ? e.code : ' + Z, 'code: err ? err.code : ' + O, 'code: err && err.code,'])
    assert.equal(bareUnchecked(sample).length, 1, sample);
  const guardedSite = "if (err && typeof err.code !== 'number') { reject(e); return; }\n      resolve({ code: err ? err.code : " + Z + ' });';
  assert.equal(bareUnchecked(guardedSite).length, 0);
  assert.equal(bareUnchecked(guardedSite + '\n' + 'x'.repeat(500) + '\nresolve({ code: err ? err.code : ' + Z + ' });').length, 1);
  for (const notExit of ["(e) => e && e.code === 'ENOENT'", 'code: last && last.code', "(e && e.code || 'read error')"])
    assert.equal(bareUnchecked(notExit).length, 0, notExit);
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
    const unchecked = bareUnchecked(src);
    if (unchecked.length) bad.push(path.relative(__dirname, f) + ' (' + unchecked.length + ' unchecked x.code)');
    if (src.includes(REJECTS)) guarded++;
  }
  assert.deepEqual(bad, [], 'these files default a missing exit code to a number');
  // The scan must actually reach the harnesses it protects (17 at the time of writing).
  assert.ok(guarded >= 17, 'only ' + guarded + ' test files reject a missing exit code; the scan may be looking in the wrong place');
});

/* The spelling rules above can never be complete: optional chaining, a reversed ternary,
   a named constant, an alias or a renamed variable all read a kill as a number while
   matching none of them (blind review, pass 4, measured). So this is the rule that
   carries the weight: every callback-style execFile in a cli.* test must itself check
   that the code is a number and reject or throw when it is not, whatever else it does. An unsafe spelling then fails by
   what it LACKS, not by what it looks like. execFileSync throws on any failure and a
   promisified execFile rejects, so neither can read a kill as a code unless a catch maps
   it, which the spelling rules cover. A site that does not read the exit code at all
   says so with the marker "exit code not read (#3628)" and why. */
test('#3628: every callback execFile in a cli.* test checks the exit code is a number', () => {
  const CALL = /\bexecFile\s*\(/g;
  const check = (src) => [...src.matchAll(CALL)].filter((m) => {
    const before = src.slice(Math.max(0, m.index - 20), m.index);
    if (/promisify\(\s*$/.test(before)) return false;              // promisify(execFile): rejects on any error
    const win = src.slice(Math.max(0, m.index - 300), m.index + 700);
    // The check must lead straight into a reject or a throw: a reversed ternary contains
    // the same text and still falls back to a number.
    return !/\.code !== 'number'\)\s*\{?\s*(?:reject|throw)\b/.test(win) && !win.includes('exit code not read (#3628)');
  });
  const Z = '0';
  // Controls: an unsafe spelling the regexes miss is caught by omission; the checked
  // harness passes; the opt-out marker passes; promisify is not a call site.
  assert.equal(check("execFile(CLI, args, {}, (err) => resolve({ code: err?.code ?? " + Z + ' }));').length, 1);
  assert.equal(check("execFile(CLI, args, {}, (err) => resolve({ code: typeof err.code !== 'number' ? " + Z + ' : err.code }));').length, 1);
  assert.equal(check("execFile(CLI, args, {}, (err, o, e2) => { if (err && typeof err.code !== 'number') { reject(err); return; } resolve({ code: err ? err.code : " + Z + ' }); });').length, 0);
  assert.equal(check('// exit code not read (#3628): asserts the stub\nexecFile(CLI, args, {}, () => resolve());').length, 0);
  assert.equal(check('const run = promisify(execFile);').length, 0);
  const self = path.join(__dirname, 'cli.exit-code-mapping-3628.test.js');
  const files = fs.readdirSync(__dirname).filter((f) => /^cli\..*\.test\.js$/.test(f)).map((f) => path.join(__dirname, f)).filter((f) => f !== self);
  const bad = [];
  let sites = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    sites += (src.match(CALL) || []).length;
    const miss = check(src);
    if (miss.length) bad.push(path.basename(f) + ' (' + miss.length + ')');
  }
  assert.deepEqual(bad, [], 'these execFile calls never check that the exit code is a number');
  // 19 callback execFile sites in 17 files, measured when this was written.
  assert.ok(sites >= 19, 'only ' + sites + ' execFile call sites found; the scan may be looking in the wrong place');
});
