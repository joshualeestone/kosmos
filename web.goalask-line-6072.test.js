'use strict';
/* kosmos#6072 slice 2: the line under a project's name when the Assigner gave up today on asking an agent to plan
   work toward its goal (paintGoalAsk), from the page's real function. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);

function rig(readFailed) {
  const els = {};
  const el = (id) => els[id] || (els[id] = { id, hidden: true, textContent: '' });
  const paint = new Function('document', 'PJ_READ_FAILED', page.liftAll(SCRIPT, ['paintGoalAsk']) + '\nreturn paintGoalAsk;')({ getElementById: el }, readFailed);
  return { paint, line: () => el('pj-one-goalask') };
}
const GAVE = { at: Date.now() - 60000, tries: 3, agent: 'Echo', session: 'echo', because: 'could_not' };

test('a project the Assigner gave up on today says who it could not reach, and what the person can do', () => {
  const { paint, line } = rig(false);
  paint({ id: 'p1', name: 'Feedback', goalAskGaveUp: GAVE });
  assert.equal(line().hidden, false);
  assert.equal(line().textContent, 'Kosmos could not reach Echo to plan the next work toward this project\'s goal (3 tries today). It will ask again tomorrow; to start sooner, give the project a task.');
  assert.doesNotMatch(line().textContent, /this Mac/, 'person-facing words say this computer, never this Mac');
});

test('no line when nothing gave up, and the line clears when the give-up goes (control: it shows first)', () => {
  const { paint, line } = rig(false);
  paint({ id: 'p1', name: 'Feedback', goalAskGaveUp: GAVE });
  assert.equal(line().hidden, false, 'CONTROL: the line shows for a give-up');
  paint({ id: 'p1', name: 'Feedback', goalAskGaveUp: null });
  assert.equal(line().hidden, true);
  assert.equal(line().textContent, '', 'a cleared give-up left its words behind');
  paint({ id: 'p2', name: 'Other' });
  assert.equal(line().hidden, true, 'a project with no field (an older board) shows a line');
});

test('a read that failed shows no line, even with a give-up on the last good copy', () => {
  const { paint, line } = rig(true);
  paint({ id: 'p1', name: 'Feedback', goalAskGaveUp: GAVE });
  assert.equal(line().hidden, true, 'a line from a read we could not make claimed what we cannot see');
});

test('the agent name is set as text, never as markup', () => {
  const { paint, line } = rig(false);
  paint({ id: 'p1', name: 'X', goalAskGaveUp: { ...GAVE, agent: '<img src=x onerror=alert(1)>' } });
  assert.match(line().textContent, /could not reach <img src=x onerror=alert\(1\)> to plan/);
  assert.match(page.liftAll(SCRIPT, ['paintGoalAsk']), /line\.textContent = /, 'the line is written with textContent');
  assert.doesNotMatch(page.liftAll(SCRIPT, ['paintGoalAsk']), /innerHTML/, 'the line is written as markup');
});

test('the line sits under the project name, beside the paused line, as a status', () => {
  assert.match(HTML, /id="pj-one-paused"[^>]*><\/p>\s*<!-- kosmos#6072[\s\S]*?-->\s*<p class="dhint" id="pj-one-goalask" role="status" hidden><\/p>/);
});
