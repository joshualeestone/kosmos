'use strict';

/**
 * #6157: tasks.waitingOnOf says WHICH agents put a task in Needs your decision and why, from the same cards as
 * waitingOnPerson, with the project page's reason codes (projects.needsYouReason). The cards are real fleet cards
 * (test-support/fleet), with only the state a real agent would be in changed.
 *
 *   node --test engine/tasks-waitingon-6157.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-waitingon-'));
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-waitingon-data-'));
process.on('exit', () => {
  for (const d of [process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_DATA]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
const projects = require('./projects');
const tasks = require('./tasks');
const fleet = require('../test-support/fleet');

/* Real cards for ann, bo and cy, copied out of the fleet (plain objects, so a state can be set as a real agent's is). */
function realCards() {
  const board = fleet.install([fleet.agent('ann'), fleet.agent('bo'), fleet.agent('cy')], { strict: false });
  try { return ['ann', 'bo', 'cy'].map((n) => ({ ...board.card(n) })); } finally { board.restore(); }
}
function setup(name) {
  const p = projects.create({ name });
  for (const a of ['ann', 'bo', 'cy']) projects.addAgent(p.id, a);
  const t = tasks.create(p.id, { sentence: 'Shared', who: 'ann' });
  tasks.addPart(p.id, t.number, { sentence: 'Second', who: 'bo' });
  tasks.addPart(p.id, t.number, { sentence: 'Third', who: 'cy' });
  const fresh = tasks.byNumber(projects.readAll().find((x) => x.id === p.id), t.number);
  return { p, t: { ...fresh, projectId: p.id } };
}

test('#6157: each holder that needs the person is named with its reason, in roster order; the others are not', () => {
  const { p, t } = setup('Reasons');
  const [ann, bo, cy] = realCards();
  const roster = [
    { ...ann, state: 'needs_you', stateProject: p.id },
    { ...bo, state: 'needs_trust' },
    { ...cy, state: 'working', crashLoop: { looping: true } },
  ];
  assert.deepEqual(tasks.waitingOnOf(t, roster), [
    { who: 'ann', reason: 'question' }, { who: 'bo', reason: 'trust' }, { who: 'cy', reason: 'crash_loop' },
  ]);
  assert.equal(tasks.waitingOnPerson(t, roster), true, 'CONTROL: the same cards make it a decision');
});

test('#6157: a question about ANOTHER project, a holder off the project, and a working agent are not named', () => {
  const { p, t } = setup('Not here');
  const [ann, bo, cy] = realCards();
  const roster = [
    { ...ann, state: 'needs_you', stateProject: 'somewhere-else' },
    { ...bo, state: 'needs_you', stateProject: p.id },
    { ...cy, state: 'working' },
  ];
  assert.deepEqual(tasks.waitingOnOf(t, roster, ['ann', 'cy']), [], 'bo is off the project and ann asks about another one');
  assert.deepEqual(tasks.waitingOnOf(t, roster), [{ who: 'bo', reason: 'question' }], 'CONTROL: with bo on it, bo is named');
});

test('#6157: a done task, or no roster, names nobody', () => {
  const { p, t } = setup('Done');
  const [ann] = realCards();
  const roster = [{ ...ann, state: 'needs_you', stateProject: p.id }];
  assert.equal(tasks.waitingOnOf(t, roster).length, 1, 'CONTROL: open, it names ann');
  tasks.close(p.id, t.number);
  const done = { ...tasks.byNumber(projects.readAll().find((x) => x.id === p.id), t.number), projectId: p.id };
  assert.deepEqual(tasks.waitingOnOf(done, roster), []);
  assert.deepEqual(tasks.waitingOnOf(t, null), []);
});

/* #6341 (Josh, 10-16 19:47: out of usage "should never show in the project, only on the agent"): an agent that is only
   out of usage does not put its task in Needs your decision. */
test('#6341: a holder out of usage is not named, and alone does not make a decision', () => {
  const { p, t } = setup('Usage');
  const [ann, bo, cy] = realCards();
  const rate = { state: 'rate_limited', stuckError: { stuck: true, state: 'rate_limited', forMs: 30 * 60000 } };
  assert.equal(projects.needsYouReason({ ...ann, ...rate, present: true, tied: true }, p.id), 'stuck_rate', 'CONTROL: the card is out of usage');
  const alone = [{ ...ann, ...rate }, { ...bo, state: 'working' }, { ...cy, state: 'idle' }];
  assert.deepEqual(tasks.waitingOnOf(t, alone), [], 'an agent out of usage was named on the task');
  assert.equal(tasks.waitingOnPerson(t, alone), false, 'an agent out of usage put the task in Needs your decision');
  const withQuestion = [{ ...ann, ...rate }, { ...bo, state: 'needs_you', stateProject: p.id }, { ...cy, state: 'idle' }];
  assert.deepEqual(tasks.waitingOnOf(t, withQuestion), [{ who: 'bo', reason: 'question' }], 'CONTROL: a question beside it is still named');
});

test('#6341 review 6: a second, real reason beside a rate limit still names the holder', () => {
  const { t } = setup('UsagePlus');
  const [ann, bo, cy] = realCards();
  const roster = [{ ...ann, state: 'rate_limited', stuckError: { stuck: true, state: 'rate_limited', forMs: 30 * 60000 }, ownBound: { raised: true } },
    { ...bo, state: 'working' }, { ...cy, state: 'idle' }];
  assert.deepEqual(tasks.waitingOnOf(t, roster), [{ who: 'ann', reason: 'own_bound' }]);
});
