'use strict';
require('../test-support/tmpscope');   // kosmos#5334: this process's temp folders, removed when it exits
/* #7786 item 2: a task held by an agent that has never taken a turn read "Rex has not reported what it is working on
   yet", the line of an agent that is running and quiet. The claim now carries `neverTurned` from the agent's card
   (status.js neverTurnedOf), only beside neverReported, and the page says "has not started yet". */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-neverturned-tasks-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('./projects');
const commitments = require('./commitments');
const selfreport = require('./selfreport');
const fleet = require('../test-support/fleet');

/* Real cards from the real producer (test-support/fleet), each with the self-report record behind its neverTurned:
   ava launched and never took a turn; bo launched and took one. */
let recorded = false;
function board() {
  if (!recorded) {   // the records first: install reads the cards, and a card's neverTurned reads the record
    selfreport.record('ava', { state: 'started', auto: true });
    selfreport.record('bo', { state: 'started', auto: true });
    selfreport.record('bo', { state: 'working', auto: true, text: 'answering a prompt' });
    selfreport.record('bo', { state: 'idle', auto: true, text: 'finished responding' });   // a turn ends with its Stop row
    recorded = true;
  }
  return fleet.install([fleet.agent('ava', { state: 'idle' }), fleet.agent('bo', { state: 'idle' })]);
}
function claimOf(roster, who) {
  const tasks = [{ number: 1, sentence: 'write the brief', who }];
  const all = [{ id: 'p', name: 'P', tasks, agents: [who] }];
  return projects.joinTaskClaims(tasks, all, [who], roster, { name: 'P', id: 'p' })[0].claim;
}

test('a never-reported claim carries neverTurned from the agent card, and only then', (t) => {
  const b = board(); t.after(() => b.restore());
  const roster = b.agents;
  const ava = roster.find((a) => a.name === 'ava'); const bo = roster.find((a) => a.name === 'bo');
  assert.equal(ava && ava.neverTurned, true, 'CONTROL: the real card says ava never took a turn');
  assert.equal(bo && bo.neverTurned, false, 'CONTROL: and bo did');
  const c = claimOf(roster, ava.sessionName);
  assert.equal(c.neverReported, true, 'CONTROL: ava has written no report on this board');
  assert.equal(c.about, ava.sessionName);
  assert.equal(c.neverTurned, true);
  assert.equal(claimOf(roster, bo.sessionName).neverTurned, undefined, 'an agent that has worked keeps the old line');
  assert.equal(claimOf([], ava.sessionName).neverTurned, undefined, 'not on the roster');
});

test('the engine stamps neverTurned only beside neverReported: an agent that has reported keeps its own claim', (t) => {
  const b = board(); t.after(() => b.restore());
  const roster = b.agents;
  const ava = roster.find((a) => a.name === 'ava');
  commitments.report(ava.sessionName, []);
  const c = claimOf(roster, ava.sessionName);
  assert.equal(c.claimed, false, 'CONTROL: ava has a report on this board, which does not name task 1');
  assert.equal(c.neverTurned, undefined, 'a card that says never turned does not override a report');
});

test('the page says "has not started yet" only for a claim the engine marked', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const m = PAGE.match(/\nfunction claimNotReported\(claim\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'CONTROL: claimNotReported was not found in the page');
  const claimNotReported = new Function(m[0] + '\nreturn claimNotReported;')();
  assert.equal(claimNotReported({ claimed: null, neverReported: true, neverTurned: true }), 'has not started yet');
  assert.equal(claimNotReported({ claimed: null, neverReported: true }), 'has not reported what it is working on yet', 'CONTROL');
  assert.equal(claimNotReported({ claimed: null, neverReported: false, neverTurned: true }), '', 'only beside neverReported');
  assert.equal(claimNotReported({ claimed: true, neverReported: true, neverTurned: true }), '', 'a definite claim says so itself');
  assert.equal(claimNotReported(null), '');
});
