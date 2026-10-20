'use strict';
/**
 * kosmos#6602: the Plus pane's certificate check line and switch (paintPlusCertWatch).
 *
 *   node --test web.plus-cert-watch-6602.test.js
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
  const el = (id) => (els[id] ||= {
    id, textContent: '', hidden: true, dataset: {}, attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
    classList: { toggle() {}, remove() {} }, addEventListener() {},
  });
  const ctx = { document: { getElementById: el }, console };
  const start = SCRIPT.indexOf('function paintSwitch(togId, on) {');
  const end = SCRIPT.indexOf('\n}\n', start) + 3;
  const cwStart = SCRIPT.indexOf('var PLUS_CW_WORDS = {');   // through plusCwSay and paintPlusCertWatch
  const cwEnd = SCRIPT.indexOf('{ const cwSw = document.getElementById(\'plus-cw-switch\');');
  assert.ok(start > 0 && cwStart > 0 && cwEnd > cwStart, 'the certificate check script moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end) + SCRIPT.slice(cwStart, cwEnd), ctx);
  return { ctx, el };
}

test('a finding is said, in the warning state, and the switch shows on', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch({ on: true, state: 'foreign', foreign: 1 });
  assert.notEqual(el('plus-cw-line').textContent, '');
  assert.match(el('plus-cw-line').textContent, /did not ask for/);
  assert.equal(el('plus-cw-line').dataset.state, 'foreign');
  assert.equal(el('plus-cw-row').hidden, false);
  assert.equal(el('plus-cw-switch').getAttribute('aria-checked'), 'true');
});

test('clear and never-run say nothing; unknown says it cannot confirm (the control for the finding above)', () => {
  const { ctx, el } = world();
  for (const state of ['clear', 'none']) {
    ctx.paintPlusCertWatch({ on: true, state });
    assert.equal(el('plus-cw-line').textContent, '', state);
  }
  ctx.paintPlusCertWatch({ on: true, state: 'unknown' });
  assert.notEqual(el('plus-cw-line').textContent, '');
  assert.match(el('plus-cw-line').textContent, /not been able to confirm/);
  ctx.paintPlusCertWatch({ on: true, state: 'unknown', failing: true });
  assert.match(el('plus-cw-line').textContent, /has been failing lately/);
});

test('switched off: a finding is still said (with "the check is off"), nothing else is, and the switch shows off', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch({ on: false, state: 'foreign', foreign: 2 });
  assert.notEqual(el('plus-cw-line').textContent, '');
  assert.match(el('plus-cw-line').textContent, /did not ask for\..* The check is off\.$/);
  assert.equal(el('plus-cw-switch').getAttribute('aria-checked'), 'false');
  ctx.paintPlusCertWatch({ on: false, state: 'unknown' });
  assert.equal(el('plus-cw-line').textContent, '');
});

test('a finding only for an earlier address says so; a lost report says so', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch({ on: true, state: 'foreign', foreign: 0, earlier: 1 });
  assert.match(el('plus-cw-line').textContent, /an address this computer used before/);
  ctx.paintPlusCertWatch({ on: true, state: 'foreign', foreign: 0, earlier: 0 });
  assert.match(el('plus-cw-line').textContent, /this computer's address/, 'foreign with no counts is not an earlier address');
  ctx.paintPlusCertWatch({ on: true, state: 'foreign', foreign: 1, earlier: 1 });
  assert.match(el('plus-cw-line').textContent, /this computer's address/);
  ctx.paintPlusCertWatch({ on: true, state: 'unknown', lost: true });
  assert.match(el('plus-cw-line').textContent, /could not be read/);
  ctx.paintPlusCertWatch({ on: true, state: 'foreign', foreign: 1, lost: true });
  assert.match(el('plus-cw-line').textContent, /did not ask for\..*could not be read/, 'a finding and a lost report are both said');
});

test('with Kosmos+ off, cannot-confirm is not said, but a finding still is', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch({ on: true, state: 'unknown' }, false);
  assert.equal(el('plus-cw-line').textContent, '');
  ctx.paintPlusCertWatch({ on: true, state: 'unknown', lost: true }, false);
  assert.equal(el('plus-cw-line').textContent, '');
  ctx.paintPlusCertWatch({ on: true, state: 'foreign', foreign: 1 }, false);
  assert.notEqual(el('plus-cw-line').textContent, '');
});

/* The click handler: lifted with its stubs, driven twice at once (the busy guard), and once refused. */
function clickWorld(answer) {
  const listeners = {};
  const sw = { attrs: { 'aria-checked': 'true' }, hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k] ?? null; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { listeners[t] = fn; } };
  const calls = [], said = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = {
    document: { getElementById: (id) => (id === 'plus-cw-switch' ? sw : null) },
    fetch: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); await gate; return answer; },
    plusSay: (m) => said.push(m), plusWords: (s) => s, paintPlus: () => {}, console,
  };
  const start = SCRIPT.indexOf("{ const cwSw = document.getElementById('plus-cw-switch');");
  const end = SCRIPT.indexOf('/* The words of the code box (#729).', start);
  assert.ok(start > 0 && end > start, 'the switch handler moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { click: listeners.click, calls, said, release, sw };
}

test('a click asks for the opposite of what the switch showed, once even when clicked twice', async () => {
  const w = clickWorld({ ok: true, json: async () => ({}) });
  const a = w.click(), b = w.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(w.sw.getAttribute('aria-busy'), 'true', 'saving is not said');
  w.release();
  await a; await b;
  assert.equal(w.calls.length, 1, 'a second click while one was in flight sent another request');
  assert.equal(w.calls[0].url, '/api/remote/cert-watch');
  assert.deepEqual(w.calls[0].body, { on: false });
  assert.equal(w.sw.getAttribute('aria-busy'), null, 'still says saving after it finished');
});

test('a refused change says why', async () => {
  const w = clickWorld({ ok: false, json: async () => ({ error: 'only you can change this, from Settings' }) });
  const a = w.click();
  w.release();
  await a;
  assert.ok(w.said.includes('only you can change this, from Settings'), JSON.stringify(w.said));
});

test('an older server with no certWatch hides the line and the switch', () => {
  const { ctx, el } = world();
  ctx.paintPlusCertWatch(undefined);
  assert.equal(el('plus-cw-line').textContent, '');
  assert.equal(el('plus-cw-row').hidden, true);
});

test('paintPlus paints it, and the markup carries the line, the switch and its label', () => {
  assert.ok(SCRIPT.includes("paintPlusCertWatch(r.certWatch, r.on === true)"), 'paintPlus no longer paints the certificate check');
  assert.match(PAGE, /<p class="fhint plus-cw-line" id="plus-cw-line" role="status"><\/p>/, 'the live line must stay in the page (not hidden) so its first text is announced');
  // .fhint:empty is display:none globally; the line overrides it, or an empty line leaves the accessibility tree.
  assert.match(PAGE, /\.fhint:empty \{ display: none; \}/, 'the global rule this override answers moved; re-check the override');
  assert.match(PAGE, /#s-sec-plus \.plus-cw-line:empty \{ display: block; margin: 0; \}/, 'the empty live line is not kept rendered');
  for (const id of ['plus-cw-line', 'plus-cw-row', 'plus-cw-switch', 'plus-cw-label']) assert.ok(PAGE.includes('id="' + id + '"'), id);
  assert.match(PAGE, /this sends the address to Cert Spotter/, 'the switch must say what it sends where');
});
