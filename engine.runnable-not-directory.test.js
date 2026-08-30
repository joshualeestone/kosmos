'use strict';
/**
 * #1592: `fs.accessSync(p, X_OK)` SUCCEEDS ON A DIRECTORY, so every hand-rolled
 * "is this runnable" check accepted a folder as an executable.
 * `engine/runners.js`'s `isRunnable` is the correct form and differs by one
 * line: `statSync(p).isFile()` before the access check.
 *
 * 🛑 WHY THIS IS A SOURCE SWEEP AND NOT SIX MOCKED ARMS. The card asked for an
 * arm per site, and the reason is that fixing a SUBSET is a route change rather
 * than a behaviour change: harden the entry check, leave the post-install check
 * weak, and a directory simply takes a different path to the same wrong answer
 * (demonstrated on #1580). A per-site behavioural mock proves one site and says
 * nothing about the next one somebody adds. This asserts the CLASS: no engine
 * file may ask the weak question at all.
 *
 * ⚠️ IT IGNORES COMMENTS ON PURPOSE. A string search cannot tell USE from
 * MENTION (#1570), and this very file's prose mentions `accessSync`. Sweeping
 * naively, the guard flags itself and every comment that explains it. That is
 * not hypothetical: while fixing #1592 I twice read my own explanatory comment
 * as an unfixed call site.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ENGINE = path.join(__dirname, 'engine');
const REPO = __dirname;

/**
 * The weak call, defined ONCE because the sweep and its control MUST use the
 * same matcher.
 *
 * 🛑 `.*`, NOT `[^)]*`, AND THIS IS THE WHOLE BUG THIS GUARD ALMOST SHIPPED
 * WITH. `[^)]*` cannot cross a nested `)`, so it is blind to any call whose
 * first argument is itself a call. Measured at the merge base: it saw
 * `fs.accessSync(bin, X_OK)` at connect.js:434 and MISSED
 * `fs.accessSync(claudeBinPath(), fs.constants.X_OK)` at connect.js:2082,
 * which is one of the sites this very branch fixes. Reverting that fix left
 * every test in this file green.
 *
 * ⭐ The control below was equally blind, because it planted only the simple
 * shape: it exercised the arm that already worked. A control aimed at the
 * working arm is not a control, which is why both now come from this constant
 * and why the control plants the nested shape too.
 *
 * ⚠️ STILL LINE-BASED: a call split across two lines is invisible to it. No
 * such call exists today and the population floor below would not catch one.
 * Stated rather than glossed.
 */
const WEAK_CALL = /accessSync\s*\(.*X_OK/;
const RUNNERS = path.join(ENGINE, 'runners.js');

/**
 * Source with comments blanked, so prose cannot trip the sweep.
 *
 * ⚠️ BLANKED, NOT REMOVED, AND THE DIFFERENCE IS THE WHOLE POINT. Deleting a
 * comment block SHIFTS EVERY LINE NUMBER BELOW IT, so the sweep reports a real
 * defect at a line that does not contain it. My first version did exactly that
 * and named machine.js:191, which is unrelated code; the call is at 412. A
 * finding nobody can locate is barely a finding.
 */
/** Every non-test .js file in the repo, relative to REPO. */
function walkJs(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(full, base, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(path.relative(base, full));
  }
  return out;
}

function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');
}

test('no engine file asks the weak runnable question: accessSync(X_OK) without isFile', () => {
  /* Repo-wide, not engine/ only. The name of this test claims a CLASS property
     ("no file asks the weak question"), and a guard narrower than the claim it
     makes is the failure it was written to prevent, arriving by a different
     door. Measured when this was widened: 137 non-test .js files, 0 weak sites,
     1 correctly cleared by machine.js's own isFile(). */
  const files = walkJs(REPO);
  // A floor: if the scan stops finding files this passes while asserting nothing.
  assert.ok(files.length > 100, `only ${files.length} files scanned; the sweep is broken`);
  assert.ok(
    files.some((f) => f.startsWith(`engine${path.sep}`)),
    'the sweep is not reaching engine/, which is where the class lives'
  );

  const weak = [];
  for (const rel of files) {
    const full = path.join(REPO, rel);
    const f = rel;
    const lines = codeOnly(fs.readFileSync(full, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!WEAK_CALL.test(line)) return;
      // runners.js is the definition of the question, so it is allowed to ask it.
      if (full === RUNNERS) return;
      /* A site that guards with isFile() itself is CORRECT, not defective: it is
         asking the same question the long way. engine/machine.js does this, and
         says why in a comment above it. This sweep is aimed at checks that
         ACCEPT A DIRECTORY, not at every spelling of a right answer, so a
         guard within the preceding few lines clears the site. */
      const before = lines.slice(Math.max(0, i - 6), i).join('\n');
      if (/isFile\s*\(\s*\)/.test(before)) return;
      weak.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(
    weak,
    [],
    'these ask accessSync(X_OK) directly, which SUCCEEDS ON A DIRECTORY. ' +
      'Use require("./runners").isRunnable(p):\n  ' + weak.join('\n  ')
  );
});

test('the sweep can actually find a weak call, so an empty result means something', () => {
  // The control the assertion above is worthless without: plant the exact shape
  // and confirm the matcher sees it. Without this, a broken regex reads as clean.
  const planted = 'try { fs.accessSync(bin, fs.constants.X_OK); } catch {}';
  assert.ok(WEAK_CALL.test(planted), 'the matcher cannot see a weak call');
  /* The shape that actually existed in this repo and that the first version of
     this matcher was blind to. Planting only the simple form above tested the
     arm that already worked. */
  const nested = 'fs.accessSync(claudeBinPath(), fs.constants.X_OK);';
  assert.ok(WEAK_CALL.test(nested), 'the matcher is blind to a nested-call argument');
  const joined = "fs.accessSync(path.join(dir, 'claude'), fs.constants.X_OK);";
  assert.ok(WEAK_CALL.test(joined), 'the matcher is blind to a path.join() argument');
  // And it must still NOT fire on a different mode.
  assert.ok(!WEAK_CALL.test('fs.accessSync(bin, fs.constants.R_OK)'), 'the matcher over-fires on R_OK');
  const commented = '// fs.accessSync(bin, fs.constants.X_OK) succeeds on a directory';
  assert.strictEqual(
    codeOnly(commented).trim(),
    '',
    'a comment mentioning the call must not be read as the call (#1570)'
  );
});

test('isRunnable rejects a directory and accepts a real executable', () => {
  const { isRunnable } = require('./engine/runners.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runnable-1592-'));
  try {
    // The defect itself, asserted so the rest is not arguing with a phantom.
    let rawSaysYes = false;
    try { fs.accessSync(dir, fs.constants.X_OK); rawSaysYes = true; } catch { rawSaysYes = false; }
    assert.strictEqual(rawSaysYes, true, 'a directory no longer passes X_OK; this card is moot');

    assert.strictEqual(isRunnable(dir), false, 'isRunnable accepted a DIRECTORY');

    const bin = path.join(dir, 'thing');
    fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bin, 0o755);
    assert.strictEqual(isRunnable(bin), true, 'isRunnable rejected a real executable');

    const notExec = path.join(dir, 'plain');
    fs.writeFileSync(notExec, 'x');
    fs.chmodSync(notExec, 0o644);
    assert.strictEqual(isRunnable(notExec), false, 'isRunnable accepted a non-executable file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Mona Lisa's finding, carried over from her parallel #1592 branch before she
 * stood down. TWO BLIND REVIEWERS HIT THIS ON HER VERSION, which is why it is
 * pinned here rather than trusted to the next reader.
 *
 * `canRunClaude` exists so the stuck screen can say whether the binary is
 * runnable, and its docblock promises "any error answers FALSE". That promise
 * holds only while the BIN RESOLUTION is inside the try: `claudeBinPath()` can
 * throw, and hoisting it into a bare `const` above the try lets the throw
 * escape `becomeStuck` entirely, so `writeState` never runs and the person is
 * left on no screen at all.
 *
 * ⚠️ THE FAILURE IS INVISIBLE TO A BEHAVIOURAL TEST that does not force a
 * throw from the resolver, and it is a tempting refactor: reading the value out
 * first reads cleaner. So this asserts the SHAPE.
 */

test('canRunClaude resolves the bin INSIDE its try, so a throw still writes the stuck screen', () => {
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'connect.js'), 'utf8');
  const anchor = src.indexOf('let canRunClaude = false;');
  assert.ok(anchor > 0, 'canRunClaude was renamed or removed; re-aim this guard');

  const region = src.slice(anchor, anchor + 600);
  const tryAt = region.indexOf('try {');
  const catchAt = region.indexOf('} catch');
  assert.ok(tryAt > -1 && catchAt > tryAt, 'canRunClaude is no longer wrapped in a try/catch');

  const guarded = region.slice(tryAt, catchAt);
  assert.ok(
    /claudeBinPath\s*\(|resolveBin\s*\(/.test(guarded),
    'the bin resolution has moved OUTSIDE canRunClaude\'s try. A throw from it now ' +
      'escapes becomeStuck and the stuck screen is never written, which breaks the ' +
      'docblock promise that any error answers false. Keep the resolution inside the try.'
  );
});
