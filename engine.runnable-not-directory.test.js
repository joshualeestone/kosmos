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
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');
}

test('no engine file asks the weak runnable question: accessSync(X_OK) without isFile', () => {
  const files = fs.readdirSync(ENGINE).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  // A floor: if the scan stops finding files this passes while asserting nothing.
  assert.ok(files.length > 10, `only ${files.length} engine files scanned; the sweep is broken`);

  const weak = [];
  for (const f of files) {
    const full = path.join(ENGINE, f);
    const lines = codeOnly(fs.readFileSync(full, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!/accessSync\s*\([^)]*X_OK/.test(line)) return;
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
  assert.ok(/accessSync\s*\([^)]*X_OK/.test(planted), 'the matcher cannot see a weak call');
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
