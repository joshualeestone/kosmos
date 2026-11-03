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
function dialog(planOnScreen) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, hidden: false, disabled: false, textContent: '', value: '', kids: [],
    set innerHTML(v) { this.kids = []; }, focus() {}, appendChild(c) { this.kids.push(c); } });
  for (const id of ['del-modal', 'del-title', 'del-small', 'del-list', 'del-type-row', 'del-typed', 'del-go', 'del-msg',
    'del-keep', 'del-typed-label', 'd-delete-msg', 'removed-msg', 'removed-wrap', 'd-delete-leftover']) el(id);
  const ctx = vm.createContext({
    String, document: { getElementById: (id) => els[id] || null, activeElement: null, createElement: () => ({ textContent: '' }) },
    paints: 0,
  });
  vm.runInContext(['let DEL_FOR = null; let DEL_PLAN = null; let DEL_RETURN = null; let DEL_OPENED = 0;',
    'let LEFTOVERS_LAST = [{ name: "Miles" }, { name: "Ada" }];',
    'function paintRemoved() { paints += 1; }',
    liftConst(SCRIPT, 'DEL_UNKNOWN_LINE'),
    liftAll(SCRIPT, ['deleteNoAnswerLine', 'deleteNoAnswerShow', 'deleteSettled', 'openDeleteModal', 'closeDeleteModal']),
    'this.show = deleteNoAnswerShow; this.open = openDeleteModal;',
    'this.state = () => ({ DEL_FOR, DEL_PLAN, DEL_OPENED, kept: LEFTOVERS_LAST.map((x) => x.name).join(",") });'].join('\n'), ctx);
  ctx.open(planOnScreen);
  return { els, ctx };
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

test('refused: the dialog closes and the screen is put right as after a delete', () => {
  const d = dialog(offered);
  d.ctx.show({ ok: false, because: 'nothing of Miles is left on this computer, so there is nothing to delete.' });
  const st = d.ctx.state();
  assert.equal(d.els['del-modal'].hidden, true);
  assert.equal(st.DEL_PLAN, null);
  assert.equal(st.kept, 'Ada', 'the name leaves the kept leftovers');
  assert.equal(d.els['d-delete-leftover'].hidden, true, 'the detail page drops its delete box');
  assert.match(d.els['d-delete-msg'].textContent, /nothing of Miles is left/);
  assert.equal(d.ctx.paints, 1, 'the removed list redraws');
});

test('no plan either: the line, the dialog stays, and the button stays off', () => {
  const d = dialog(offered);
  d.els['del-go'].disabled = true;
  d.ctx.show(null);
  assert.equal(d.els['del-modal'].hidden, false);
  assert.equal(d.els['del-go'].disabled, true);
  assert.equal(d.els['del-msg'].textContent, UNKNOWN);
  assert.equal(d.ctx.state().kept, 'Miles,Ada', 'CONTROL: nothing is cleared on not knowing');
});

test('opening or closing the dialog moves the token the click handler checks', () => {
  const d = dialog(offered);
  const before = d.ctx.state().DEL_OPENED;
  d.ctx.open(offered);
  assert.equal(d.ctx.state().DEL_OPENED, before + 1);
});

test('the click handler asks the plan again on no answer, and never says Nothing was deleted', () => {
  const at = SCRIPT.indexOf("document.getElementById('del-go').addEventListener('click'");
  const end = SCRIPT.indexOf('deleteSettled(DEL_FOR', at);
  assert.ok(at > -1 && end > at, 'the delete click handler moved; re-anchor');
  const h = SCRIPT.slice(at, end);
  assert.match(h, /if \(!res \|\| !body\) \{\s*const opened = DEL_OPENED;\s*const plan = await fetchLeftoverPlan\(DEL_FOR\);\s*if \(opened !== DEL_OPENED\) return;/,
    'a dialog closed or opened again meanwhile is not written into');
  assert.match(h, /deleteNoAnswerShow\(plan\)/);
  assert.doesNotMatch(h, /Nothing was deleted/);
});
