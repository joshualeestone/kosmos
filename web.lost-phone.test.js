'use strict';
/**
 * #733 recovery, the control under Plus: "I lost my phone" resets the
 * account's second step through the Mac's own signed request. Driven
 * THROUGH the click binding against a fake fetch: the first click arms and
 * asks nothing, the second asks once, and the outcome is said in words,
 * the engine's when it refused.
 *
 *   node --test web.lost-phone.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function world(fetchImpl) {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', hidden: id === 'plus-second-msg', disabled: false, listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } });
  const ctx = { document: { getElementById: el }, fetch: fetchImpl, plusWords: (s) => s, console };
  const start = SCRIPT.indexOf('const PLUS_SECOND_WORDS');
  const end = SCRIPT.indexOf('function paintModelWhy(');
  assert.ok(start > 0 && end > start, 'the lost-phone script moved; re-anchor');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { ctx, el, click: () => el('plus-second-reset').listeners.click() };
}

test('the control lives under Plus, hidden until enrolled, and paints with the devices', () => {
  const sec = PAGE.slice(PAGE.indexOf('id="s-sec-plus"'), PAGE.indexOf('</section>', PAGE.indexOf('id="plus-flow"')));
  assert.match(sec, /id="plus-second" hidden/, 'the control does not start hidden');
  assert.match(sec, /I lost my phone/);
  assert.match(sec, /Nobody else can/, 'the sentence that says there is no support path is gone');
  const paint = SCRIPT.slice(SCRIPT.indexOf('async function paintPlus('), SCRIPT.indexOf("document.getElementById('plus-switch').addEventListener"));
  assert.match(paint, /plus-second'\)\.hidden = r\.enrolled !== true/, 'the control is not gated on enrolled; an unenrolled Mac cannot sign the request');
  assert.match(paint, /plusSecondDisarm\(\)/, 'a repaint leaves a half-taken click armed');
});

test('the first click arms and asks nothing; the second asks once and says it is done', async () => {
  const calls = [];
  const w = world(async (url, opts) => { calls.push([url, (opts || {}).method]); return { ok: true, json: async () => ({ ok: true }) }; });
  await w.click();
  assert.deepEqual(calls, [], 'one click reached the engine');
  assert.equal(w.el('plus-second-reset').textContent, 'Yes, reset it');
  assert.match(w.el('plus-second-msg').textContent, /once more/);
  await w.click();
  assert.deepEqual(calls, [['/api/remote/second-reset', 'POST']]);
  assert.match(w.el('plus-second-msg').textContent, /^The second step is off\./);
  assert.match(w.el('plus-second-msg').textContent, /new phone/);
  assert.equal(w.el('plus-second-reset').textContent, 'Reset the second step', 'the button did not disarm after the reset');
  assert.equal(w.el('plus-second-reset').disabled, false);
});

test("a refusal is said in the engine's own words, and the button comes back", async () => {
  let asked = 0;
  const w = world(async () => { asked += 1; return { ok: false, json: async () => ({ error: 'the coordinator said no (401): unknown mac' }) }; });
  await w.click(); await w.click();
  assert.equal(asked, 1);
  assert.equal(w.el('plus-second-msg').textContent, 'The second step was not reset: the coordinator said no (401): unknown mac.');
  assert.equal(w.el('plus-second-reset').disabled, false);
  await w.click();
  assert.equal(asked, 1, 'still armed after a refusal; the third click fired blind');
  assert.equal(w.el('plus-second-reset').textContent, 'Yes, reset it', 'the third click did not re-arm');
});

test('an engine that cannot be reached is said as that, not as done', async () => {
  const w = world(async () => { throw new Error('ECONNREFUSED'); });
  await w.click(); await w.click();
  assert.match(w.el('plus-second-msg').textContent, /not reset: this computer could not reach its own engine\./);
});
