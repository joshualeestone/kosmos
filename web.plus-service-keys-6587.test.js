'use strict';
/**
 * kosmos#6587 (S-7a slice 2a): the Plus pane's service key line (paintPlusServiceKeys). Said only for a mismatch.
 *
 *   node --test web.plus-service-keys-6587.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = require(path.join(__dirname, 'test-support/page'));
const PAGE = fs.readFileSync(path.join(__dirname, 'web/index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function world() {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', hidden: false, dataset: {} });
  const ctx = { document: { getElementById: el }, console };
  const start = SCRIPT.indexOf('var PLUS_SK_MISMATCH = ');
  const end = SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function paintPlusServiceKeys(sk) {', start)) + 3;
  assert.ok(start > 0 && end > start, 'the service key line script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { ctx, el };
}

test('a mismatch is said, in the warning state', () => {
  const { ctx, el } = world();
  ctx.paintPlusServiceKeys({ state: 'mismatch' });
  assert.match(el('plus-sk-line').textContent, /^Warning: the key this computer trusts for the Kosmos\+ service is not on the signed list/);
  assert.equal(el('plus-sk-line').dataset.state, 'mismatch');
});

test('every other state says nothing, and clears a mismatch shown before (the control for the arm above)', () => {
  const { ctx, el } = world();
  for (const state of ['off', 'refused', 'none', 'unknown', 'listed', '', 'something new']) {
    ctx.paintPlusServiceKeys({ state: 'mismatch' });
    assert.notEqual(el('plus-sk-line').textContent, '', 'CONTROL: said before ' + state);
    ctx.paintPlusServiceKeys({ state });
    assert.equal(el('plus-sk-line').textContent, '', state);
    assert.equal(el('plus-sk-line').dataset.state, '', state);
  }
});

test('an answer with no serviceKeys (an older board) leaves the line as it is', () => {
  const { ctx, el } = world();
  ctx.paintPlusServiceKeys({ state: 'mismatch' });
  for (const none of [undefined, null, 'mismatch', 5]) {
    ctx.paintPlusServiceKeys(none);
    assert.notEqual(el('plus-sk-line').textContent, '', 'kept for ' + String(none));
  }
});

test('the page wires it: the line is in the Plus flow, paintPlus paints it, and the not-set-up branch clears it', () => {
  const flow = PAGE.slice(PAGE.indexOf('id="plus-cw-row"'), PAGE.indexOf('id="plus-join"'));
  assert.match(flow, /<p class="fhint plus-sk-line" id="plus-sk-line" role="status"><\/p>/, 'beside the certificate check line');
  assert.match(SCRIPT, /paintPlusServiceKeys\(r\.serviceKeys\);/, 'paintPlus paints it from the answer');
  assert.match(SCRIPT, /r\.enrolled === false && typeof paintPlusServiceKeys === 'function'\) paintPlusServiceKeys\(\{ state: '' \}\)/, 'cleared off setup');
  // The sentence is fixed text only: no field of the answer is written into it.
  const fn = SCRIPT.slice(SCRIPT.indexOf('function paintPlusServiceKeys(sk) {'), SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function paintPlusServiceKeys(sk) {')));
  assert.doesNotMatch(fn, /innerHTML|sk\.(?!state)/, 'only sk.state is read, and nothing is written as markup');
});
