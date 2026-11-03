'use strict';
/**
 * kosmos#7852: a delete of what is left whose request got no answer may still be running on the board, so the dialog
 * must not say "Nothing was deleted". It asks for the plan again and says what that finds. The page's own
 * deleteNoAnswerLine runs here, and the click handler is read for the path that calls it.
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

test('the click handler asks the plan again on no answer, and never says Nothing was deleted', () => {
  const at = SCRIPT.indexOf("document.getElementById('del-go').addEventListener('click'");
  const end = SCRIPT.indexOf('closeDeleteModal();', at);
  assert.ok(at > -1 && end > at, 'the delete click handler moved; re-anchor');
  const h = SCRIPT.slice(at, end);
  assert.match(h, /if \(!res \|\| !body\) \{\s*const asked = DEL_FOR;\s*const plan = await fetchLeftoverPlan\(asked\);/);
  assert.match(h, /deleteNoAnswerLine\(plan\)/);
  assert.match(h, /if \(DEL_FOR !== asked\) return;/, 'a dialog closed meanwhile is not written into');
  assert.doesNotMatch(h, /Nothing was deleted/);
});
