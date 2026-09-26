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

const YML = fs.readFileSync(path.join(__dirname, '.github', 'workflows', 'test.yml'), 'utf8');

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

test('#4021: a main run is never cancelled; a PR\'s superseded run still is', () => {
  const block = concurrencyBlock(YML);
  assert.equal(cancelsOn(block, 'refs/heads/main'), false, 'main\'s run can be cancelled by the next merge again');
  assert.equal(cancelsOn(block, 'refs/pull/4021/merge'), true, 'a PR\'s superseded run is no longer cancelled (the #3499 contention)');
});

test('#4021 control: the reader sees the old setting as cancelling main', () => {
  const old = YML.replace(/(^\s+cancel-in-progress:).*$/m, '$1 true');
  assert.notEqual(old, YML, 'the control did not change the text');
  assert.equal(cancelsOn(concurrencyBlock(old), 'refs/heads/main'), true);
});
