'use strict';
/**
 * kosmos#6602: the Plus pane's certificate check line and switch (paintPlusCertWatch).
 *
 *   node --test web.plus-cert-watch-6602.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function world() {
  const els = {};
  const el = (id) => (els[id] ||= {
    id, textContent: '', hidden: true, dataset: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
    classList: { toggle() {}, remove() {} }, addEventListener() {},
  });
  const ctx = { document: { getElementById: el }, console };
  const start = SCRIPT.indexOf('function paintSwitch(togId, on) {');
  const end = SCRIPT.indexOf('\n}\n', start) + 3;
  const cwStart = SCRIPT.indexOf('const PLUS_CW_WORDS = {');
  const cwEnd = SCRIPT.indexOf('{ const cwSw = document.getElementById(\'plus-cw-switch\');');
  assert.ok(start > 0 && cwStart > 0 && cwEnd > cwStart, 'the certificate check script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end) + SCRIPT.slice(cwStart, cwEnd), ctx);
  return { ctx, el };
}

test('a finding is said, in the warning state, and the switch shows on', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch({ on: true, state: 'foreign', foreign: 1 });
  assert.equal(el('plus-cw-line').hidden, false);
  assert.match(el('plus-cw-line').textContent, /did not ask for/);
  assert.equal(el('plus-cw-line').dataset.state, 'foreign');
  assert.equal(el('plus-cw-row').hidden, false);
  assert.equal(el('plus-cw-switch').getAttribute('aria-checked'), 'true');
});

test('clear and never-run say nothing; unknown says it cannot confirm (the control for the finding above)', () => {
  const { ctx, el } = world();
  for (const state of ['clear', 'none']) {
    ctx.paintPlusCertWatch({ on: true, state });
    assert.equal(el('plus-cw-line').hidden, true, state);
    assert.equal(el('plus-cw-line').textContent, '', state);
  }
  ctx.paintPlusCertWatch({ on: true, state: 'unknown' });
  assert.equal(el('plus-cw-line').hidden, false);
  assert.match(el('plus-cw-line').textContent, /not been able to confirm/);
});

test('switched off: no line even with a finding, and the switch shows off', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch({ on: false, state: 'foreign', foreign: 2 });
  assert.equal(el('plus-cw-line').hidden, true);
  assert.equal(el('plus-cw-switch').getAttribute('aria-checked'), 'false');
});

test('an older server with no certWatch hides the line and the switch', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch(undefined);
  assert.equal(el('plus-cw-line').hidden, true);
  assert.equal(el('plus-cw-row').hidden, true);
});

test('paintPlus paints it, and the markup carries the line, the switch and its label', () => {
  assert.ok(SCRIPT.includes("paintPlusCertWatch(r.certWatch)"), 'paintPlus no longer paints the certificate check');
  for (const id of ['plus-cw-line', 'plus-cw-row', 'plus-cw-switch', 'plus-cw-label']) assert.ok(PAGE.includes('id="' + id + '"'), id);
  assert.match(PAGE, /this sends the address to Cert Spotter/, 'the switch must say what it sends where');
});
