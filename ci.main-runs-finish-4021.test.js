'use strict';

/**
 * #4021: main's suite run must never be cancelled by the next merge. On 2026-09-26 every
 * main run for an hour was cancelled, so a red main showed first at a release cut's step 3.
 * A PR's superseded run is still cancelled (that is the #3499 contention fix).
 *
 * A SOURCE pin on .github/workflows/test.yml: GitHub evaluates the expression, nothing here
 * can run it, so the test checks the text and evaluates the expression for both refs.
 *
 *   node --test ci.main-runs-finish-4021.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* Every workflow that runs on a push to main: the suite, and the two app builds (#3499 keeps the
   three in lockstep). A new push-to-main workflow belongs in this list. */
const WORKFLOWS = ['test.yml', 'android.yml', 'ios.yml'];
const read = (f) => fs.readFileSync(path.join(__dirname, '.github', 'workflows', f), 'utf8');
const YML = read('test.yml');

/* The workflow's top-level concurrency block: from `concurrency:` at column 0 to the next
   top-level key. */
function concurrencyBlock(text) {
  const m = text.match(/^concurrency:\n((?:[ \t]+.*\n|[ \t]*#.*\n|\n)*)/m);
  assert.ok(m, 'test.yml has no top-level concurrency block');
  return m[1];
}

/* Evaluate the only expression shape allowed here, `${{ github.ref != '<ref>' }}`, or a literal. */
function cancelsOn(block, ref) {
  const line = block.split('\n').find((l) => /^\s+cancel-in-progress:/.test(l));
  assert.ok(line, 'no cancel-in-progress line in the concurrency block');
  const v = line.replace(/^\s+cancel-in-progress:\s*/, '').replace(/\s+#.*$/, '').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  const e = v.match(/^\$\{\{\s*github\.ref\s*(!=|==)\s*'([^']+)'\s*\}\}$/);
  assert.ok(e, 'cancel-in-progress is an expression this pin cannot read: ' + v + ' (update the pin with it)');
  return e[1] === '!=' ? ref !== e[2] : ref === e[2];
}

for (const f of WORKFLOWS) {
  test('#4021: ' + f + ': a main run is never cancelled; a PR\'s superseded run still is', () => {
    const block = concurrencyBlock(read(f));
    assert.equal(cancelsOn(block, 'refs/heads/main'), false, f + ': main\'s run can be cancelled by the next merge again');
    assert.equal(cancelsOn(block, 'refs/pull/4021/merge'), true, f + ': a PR\'s superseded run is no longer cancelled (the #3499 contention)');
  });
}

test('#4021 control: the reader sees the old setting as cancelling main', () => {
  /* Built from the line's shape, not from the live value, so this control stays meaningful (and
     quiet) even when the live file regresses to the old setting: test 1 names that. */
  const old = YML.replace(/(^\s+cancel-in-progress:).*$/m, '$1 true');
  assert.match(old, /^\s+cancel-in-progress: true$/m, 'the control could not write the old setting');
  assert.equal(cancelsOn(concurrencyBlock(old), 'refs/heads/main'), true);
});

test('#4021 control: every workflow that runs on a push to main is in the list', () => {
  const dir = path.join(__dirname, '.github', 'workflows');
  const onMain = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).filter((f) => {
    const t = read(f);
    return /^on:[\s\S]*?^\s+push:[\s\S]*?branches:\s*\[[^\]]*["']main["']/m.test(t);
  });
  assert.ok(onMain.includes('test.yml'), 'the push-to-main detector cannot see test.yml');
  assert.deepEqual(onMain.filter((f) => !WORKFLOWS.includes(f)), [], 'a push-to-main workflow is not pinned here');
});
