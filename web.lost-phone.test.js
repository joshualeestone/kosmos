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
  // #4080: the dialog's Escape and Tab listeners sit on the document; the stub takes them and ignores them.
  const ctx = { document: { getElementById: el, addEventListener() {}, activeElement: null }, fetch: fetchImpl, plusWords: (s) => s, console };
  const start = SCRIPT.indexOf('const PLUS_SECOND_WORDS');
  const end = SCRIPT.indexOf('function paintModelWhy(');
  assert.ok(start > 0 && end > start, 'the lost-phone script moved; re-anchor');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { ctx, el, click: () => el('plus-second-reset').listeners.click() };
}

test('the control lives behind "Lost your phone?" under Plus, hidden until enrolled (#4080: a dialog, not the essay)', () => {
  const sec = PAGE.slice(PAGE.indexOf('id="s-sec-plus"'), PAGE.indexOf('</section>', PAGE.indexOf('id="plus-flow"')));
  // #4080 (Josh, 22:06: the essay "probably doesnt belong on that page"): the pane carries one link, in a block that shows only when enrolled.
  // #5791 (Josh 10-10): out of the bottom row, into the devices block (also enrolled-only), under the device list.
  assert.match(sec, /<div id="plus-devices" hidden[^>]*>[\s\S]*?id="plus-lost-open">Lost your phone\?<\/button>\s*<\/div>/, 'the Lost your phone? link is not in the enrolled-only devices block');
  assert.doesNotMatch(sec.slice(sec.indexOf('id="plus-forget"'), sec.indexOf('id="plus-forget-ask"')), /plus-lost-open/, '#5791: the link is back in the bottom row');
  assert.doesNotMatch(sec, /<p class="setname">I lost my phone<\/p>/, 'the essay is back on the pane');
  const dAt = PAGE.indexOf('<div class="rm-back" id="plus-lost-modal" hidden>');
  const dlg = dAt > 0 ? PAGE.slice(dAt, PAGE.indexOf('</section>', dAt)) : '';
  assert.ok(dlg.length > 100, 'the lost-phone dialog is gone');
  assert.match(dlg, /id="plus-second-reset"/, 'the reset is not in the dialog');
  assert.match(dlg, /always asks for a second code/, 'the ALWAYS ruling (Josh, 2026-08-29) is gone from the words');
  assert.match(dlg, /Nobody else can/, 'the sentence that says there is no support path is gone');
  const sec2 = dlg;
  // kosmos#3860: every live Mac on the account can reset the step, not only this one. The
  // sentence used to say "this computer can ... Nobody else can", which read as this Mac alone.
  assert.match(sec2, /this computer, or any other computer connected to this account, can switch the second step off/, 'kosmos#3860: the sentence says only this computer can reset the step');
  // #6611: the dialog's opening words say the sign-out too, before the button is pressed at all.
  assert.match(sec2, /Switching it off also means every phone and browser on your account will need to sign in again\./, '#6611: the dialog does not say a reset signs everyone out');
  const paint = SCRIPT.slice(SCRIPT.indexOf('async function paintPlus('), SCRIPT.indexOf("document.getElementById('plus-switch').addEventListener"));
  assert.match(paint, /getElementById\('plus-devices'\)\.hidden = r\.enrolled !== true/, 'the block with the link is not gated on enrolled; an unenrolled Mac cannot sign the request');
  assert.match(paint, /plusSecondDisarm\(\)/, 'a repaint leaves a half-taken click armed');
});

test('the first click arms and asks nothing; the second asks once and says it is done', async () => {
  const calls = [];
  const w = world(async (url, opts) => { calls.push([url, (opts || {}).method]); return { ok: true, json: async () => ({ ok: true, had: 'totp' }) }; });
  await w.click();
  assert.deepEqual(calls, [], 'one click reached the engine');
  assert.equal(w.el('plus-second-reset').textContent, 'Yes, reset it');
  assert.match(w.el('plus-second-msg').textContent, /once more/);
  // #6611: the person hears about the sign-out before they agree to it.
  assert.match(w.el('plus-second-msg').textContent, /Every phone and browser signed in to your account will need to sign in again\./);
  await w.click();
  assert.deepEqual(calls, [['/api/remote/second-reset', 'POST']]);
  assert.match(w.el('plus-second-msg').textContent, /^The second step is off\./);
  assert.match(w.el('plus-second-msg').textContent, /new phone/);
  assert.match(w.el('plus-second-msg').textContent, /Every phone and browser will need to sign in again/);
  assert.equal(w.el('plus-second-reset').textContent, 'Reset the second step', 'the button did not disarm after the reset');
  assert.equal(w.el('plus-second-reset').disabled, false);
});

// #6611: the done words follow what the coordinator reported clearing. No factor cleared (had: null) must never say
// anyone was signed out; an answer without `had` (one that went wrong somewhere) gets the words that claim no sign-out.
for (const [label, body, want, notWant] of [
  ['nothing to clear', { ok: true, had: null }, /^There was no second step on your account to switch off, so nobody was signed out\. If you had started setting one up, start again\.$/, /Every phone and browser/],
  ['without had', { ok: true }, /^The second step is off\. Sign in from your new phone/, /Every phone and browser/],
]) {
  test('#6611: a reset that answered ' + label + ' says only what happened', async () => {
    const w = world(async () => ({ ok: true, json: async () => body }));
    await w.click();
    await w.click();
    assert.match(w.el('plus-second-msg').textContent, want);
    assert.doesNotMatch(w.el('plus-second-msg').textContent, notWant);
  });
}

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
