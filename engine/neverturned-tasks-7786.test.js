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

function claimOf(card) {
  const tasks = [{ number: 1, sentence: 'write the brief', who: 'ava' }];
  const all = [{ id: 'p', name: 'P', tasks, agents: ['ava'] }];
  const out = projects.joinTaskClaims(tasks, all, ['ava'], card ? [card] : [], { name: 'P', id: 'p' });
  return out[0].claim;
}

test('a never-reported claim carries neverTurned from the agent card, and only then', () => {
  const c = claimOf({ sessionName: 'ava', isNamedOurs: true, neverTurned: true, state: 'idle' });
  assert.equal(c.neverReported, true, 'CONTROL: ava has written no report on this board');
  assert.equal(c.about, 'ava');
  assert.equal(c.neverTurned, true);
  assert.equal(claimOf({ sessionName: 'ava', isNamedOurs: true, neverTurned: false, state: 'idle' }).neverTurned, undefined, 'a card that has turned');
  assert.equal(claimOf({ sessionName: 'ava', isNamedOurs: true, state: 'idle' }).neverTurned, undefined, 'no field on the card');
  assert.equal(claimOf(null).neverTurned, undefined, 'not on the roster');
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
