'use strict';
/**
 * kosmos#7852: a delete of what is left whose request got no answer may still be running on the board, so the dialog
 * must not say "Nothing was deleted". It asks for the plan again and says what that finds. The page's own
 * dialog functions run here on a stubbed DOM, and the click handler is read for the path that calls them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scriptOf, liftAll, liftConst } = require('./test-support/page');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
/* The del-go click handler is an anonymous arrow; lift it by its anchor and balanced braces (it holds no brace in a
   string or regex, which the walk would miscount). */
function liftHandler() {
  const at = SCRIPT.indexOf("document.getElementById('del-go').addEventListener('click', async () => {");
  assert.ok(at > -1, 'the delete click handler moved; re-anchor');
  const from = SCRIPT.indexOf('async () => {', at);
  let i = SCRIPT.indexOf('{', from), depth = 0;
  for (; i < SCRIPT.length; i++) { if (SCRIPT[i] === '{') depth++; else if (SCRIPT[i] === '}' && --depth === 0) break; }
  return SCRIPT.slice(from, i + 1);
}
const line = vm.runInNewContext([liftConst(SCRIPT, 'DEL_UNKNOWN_LINE'), liftAll(SCRIPT, ['deleteNoAnswerLine'])].join('\n') + '\ndeleteNoAnswerLine', {});
const UNKNOWN = vm.runInNewContext(liftConst(SCRIPT, 'DEL_UNKNOWN_LINE') + '; DEL_UNKNOWN_LINE', {});

test('no plan either: nobody knows, and the line says so', () => {
  assert.equal(line(null), UNKNOWN);
  assert.match(UNKNOWN, /cannot tell whether anything was deleted/);
  assert.doesNotMatch(UNKNOWN, /Nothing was deleted/);
});

test('the plan refuses: the board says what is so, in its own words', () => {
  const finished = "nothing of Miles is left on this computer, so there is nothing to delete. If the name is still refused, something else holds it.";
  assert.equal(line({ ok: false, because: finished }), finished, 'the delete finished');
  const running = 'a delete of what is left of this agent is running now; try again when it has finished';
  assert.equal(line({ ok: false, because: running }), running, 'the delete is still running (kosmos#7835)');
  assert.equal(line({ ok: false }), UNKNOWN, 'CONTROL: a refusal with no words falls back to not knowing');
});

test('the plan still offers a delete: something is still here', () => {
  const said = line({ ok: true, name: 'Miles' });
  assert.match(said, /what is left of this agent is still here/);
  assert.doesNotMatch(said, /Nothing was deleted/, 'a delete that got partway would make that false');
});

/* The page's own dialog functions on a stubbed DOM: what the screen shows once the plan has been asked again. */
function dialog(planOnScreen, detailFor = null) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, hidden: false, disabled: false, textContent: '', value: '', kids: [],
    set innerHTML(v) { this.kids = []; }, focus() {}, appendChild(c) { this.kids.push(c); } });
  for (const id of ['del-modal', 'del-title', 'del-small', 'del-list', 'del-type-row', 'del-typed', 'del-go', 'del-msg',
    'del-keep', 'del-typed-label', 'd-delete-msg', 'removed-msg', 'removed-wrap', 'd-delete-leftover']) el(id);
  const calls = [];
  const replies = [];   // each: (url, opts) => a promise of a Response-like, or a rejection
  const ctx = vm.createContext({
    String, JSON, encodeURIComponent, Promise,
    document: { getElementById: (id) => els[id] || null, activeElement: null, createElement: () => ({ textContent: '' }) },
    paints: 0,
    fetch: (url, opts) => { calls.push({ url, method: (opts && opts.method) || 'GET' }); return replies.shift()(url, opts); },
  });
  vm.runInContext(['let DEL_FOR = null; let DEL_PLAN = null; let DEL_RETURN = null; let DEL_OPENED = 0;',
    'let CURRENT = ' + JSON.stringify(detailFor ? { sessionName: detailFor } : null) + ';',
    'let LEFTOVERS_LAST = [{ name: "Miles" }, { name: "Ada" }];',
    'function paintRemoved() { paints += 1; }',
    liftConst(SCRIPT, 'DEL_UNKNOWN_LINE'),
    liftAll(SCRIPT, ['fetchLeftoverPlan', 'deleteNoAnswerLine', 'deleteNoAnswerShow', 'deleteSettled', 'openDeleteModal', 'closeDeleteModal']),
    'this.click = ' + liftHandler() + ';',
    'this.show = deleteNoAnswerShow; this.open = openDeleteModal; this.close = closeDeleteModal;',
    'this.state = () => ({ DEL_FOR, DEL_PLAN, DEL_OPENED, kept: LEFTOVERS_LAST.map((x) => x.name).join(",") });'].join('\n'), ctx);
  ctx.open(planOnScreen);
  return { els, ctx, calls, replies };
}
const offered = { ok: true, name: 'Miles', question: 'Delete?', reassurance: '', loses: ['a', 'b'], verb: 'Delete' };

test('still offered: the dialog repaints with the new plan, says what is left, and gates the button as that plan asks', () => {
  const plain = dialog(offered);
  plain.els['del-go'].disabled = true;   // as the click left it
  plain.ctx.show({ ...offered, loses: ['b'] });
  assert.equal(plain.els['del-modal'].hidden, false);
  assert.equal(plain.els['del-go'].disabled, false, 'no name to type: the button comes back');
  assert.equal(plain.els['del-list'].kids.length, 1, 'the list is the new plan\'s');
  assert.match(plain.els['del-msg'].textContent, /still here/);
  const typed = dialog(offered);
  typed.ctx.show({ ...offered, typeToConfirm: 'Miles' });
  assert.equal(typed.els['del-go'].disabled, true, 'a plan that asks for the name keeps the button off until it is typed');
  assert.equal(typed.els['del-type-row'].hidden, false);
});

test('refused: the board\'s words in the dialog, the button off, the delete box hidden, the kept leftovers left alone', () => {
  for (const because of ['nothing of Miles is left on this computer, so there is nothing to delete.',
    'we could not check whether Miles is running right now, so we have not offered to delete anything. Try again in a moment.']) {
    const d = dialog(offered);
    d.els['del-go'].disabled = true;
    d.ctx.show({ ok: false, because });
    assert.equal(d.els['del-modal'].hidden, false, 'the dialog stays to say it');
    assert.equal(d.els['del-msg'].textContent, because);
    assert.equal(d.els['del-go'].disabled, true);
    assert.equal(d.els['d-delete-leftover'].hidden, true, 'the detail page drops its delete box, as for any refusal');
    assert.equal(d.ctx.state().DEL_PLAN, null);
    assert.equal(d.ctx.state().kept, 'Miles,Ada', 'a refusal can be passing, so the next read decides the list');
  }
});

test('no plan either: the line, the dialog stays, and the button follows the plan on screen so the person can retry', () => {
  const d = dialog(offered);
  d.els['del-go'].disabled = true;
  d.ctx.show(null);
  assert.equal(d.els['del-modal'].hidden, false);
  assert.equal(d.els['del-go'].disabled, false, 'no name to type: a retry is open');
  assert.equal(d.els['del-msg'].textContent, UNKNOWN);
  const typed = dialog({ ...offered, typeToConfirm: 'Miles' });
  typed.els['del-go'].disabled = true;
  typed.ctx.show(null);
  assert.equal(typed.els['del-go'].disabled, true, 'a plan that asks for the name: off until it is typed');
  typed.els['del-typed'].value = 'Miles';
  typed.ctx.show(null);
  assert.equal(typed.els['del-go'].disabled, false, 'CONTROL: the name typed, the retry is open');
  assert.equal(d.ctx.state().kept, 'Miles,Ada', 'CONTROL: nothing is cleared on not knowing');
});

test('opening and closing the dialog each move the token the click handler checks', () => {
  const d = dialog(offered);
  const before = d.ctx.state().DEL_OPENED;
  d.ctx.open(offered);
  assert.equal(d.ctx.state().DEL_OPENED, before + 1);
  d.ctx.close();
  assert.equal(d.ctx.state().DEL_OPENED, before + 2);
});

const json = (status, body) => () => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const dropped = () => Promise.reject(new TypeError('Failed to fetch'));
const proxyPage = () => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('not JSON')) });

test('the handler, run: a dropped delete asks the plan again for the same agent and says what it finds', async () => {
  const d = dialog(offered);
  d.replies.push(dropped, json(200, { ok: false, because: 'nothing of Miles is left on this computer, so there is nothing to delete.' }));
  await d.ctx.click();
  assert.deepEqual(d.calls.map((c) => c.method + ' ' + c.url), ['DELETE /api/agent/Miles/leftover', 'GET /api/agent/Miles/leftover']);
  assert.match(d.els['del-msg'].textContent, /nothing of Miles is left/);
  assert.doesNotMatch(d.els['del-msg'].textContent, /Nothing was deleted/);
});

test('the handler, run: a proxy page is no answer too, and a GET that fails with {error} is no plan', async () => {
  const d = dialog(offered);
  d.replies.push(proxyPage, json(500, { error: 'we could not work out what is left of this agent' }));
  await d.ctx.click();
  assert.equal(d.els['del-msg'].textContent, UNKNOWN);
  assert.equal(d.els['del-modal'].hidden, false);
  assert.equal(d.els['d-delete-leftover'].hidden, false, 'CONTROL: no plan is not a refusal, the box stays');
});

test('the handler, run: Keep pressed while the delete hangs, then no answer: nothing is asked and nothing is written', async () => {
  const d = dialog(offered);
  let fail;
  d.replies.push(() => new Promise((_, rej) => { fail = rej; }));
  const done = d.ctx.click();
  d.ctx.close();
  d.els['d-delete-msg'].textContent = '';
  fail(new TypeError('Failed to fetch'));
  await done;
  assert.equal(d.calls.length, 1, 'no second read, and never for a null name');
  assert.equal(d.els['d-delete-msg'].textContent, '');
  assert.equal(d.els['d-delete-leftover'].hidden, false);
});

test('the handler, run: reopened for another agent while the delete hangs, its success does not close that dialog', async () => {
  const d = dialog(offered, 'Ada');   // the detail page shows Ada
  let ok;
  d.replies.push(() => new Promise((res) => { ok = res; }));
  const done = d.ctx.click();
  d.ctx.open({ ...offered, name: 'Ada', typeToConfirm: 'Ada' });
  ok({ ok: true, status: 200, json: () => Promise.resolve({ outcome: 'deleted', said: 'Miles is gone.' }) });
  await done;
  assert.equal(d.els['del-modal'].hidden, false, 'Ada\'s dialog stays open');
  assert.equal(d.ctx.state().DEL_FOR, 'Ada');
  assert.equal(d.ctx.state().DEL_PLAN && d.ctx.state().DEL_PLAN.typeToConfirm, 'Ada', 'Ada\'s plan stays, so typing her name still opens the button');
  assert.equal(d.ctx.state().kept, 'Ada', 'Miles, the one deleted, leaves the kept leftovers');
  assert.equal(d.els['d-delete-msg'].textContent, '', 'Ada\'s detail page is not told about Miles');
  assert.equal(d.els['d-delete-leftover'].hidden, false, 'nor loses her delete box');
});

test('the handler, run: a delete from the deleted agent\'s own detail page settles that page', async () => {
  const d = dialog(offered, 'Miles');
  d.replies.push(json(200, { outcome: 'deleted', said: 'Miles is gone.' }));
  await d.ctx.click();
  assert.equal(d.els['del-modal'].hidden, true);
  assert.equal(d.els['d-delete-msg'].textContent, 'Miles is gone.');
  assert.equal(d.els['d-delete-leftover'].hidden, true);
  assert.equal(d.ctx.state().DEL_PLAN, null);
  assert.equal(d.ctx.paints, 1, 'the removed list redraws');
});

test('the click handler never says Nothing was deleted', () => {
  assert.doesNotMatch(liftHandler(), /Nothing was deleted/);
});
