'use strict';
/**
 * #4569 fix 4 (review round 2): the queue count reaches BOTH card builders in status.snapshot(), the pane card and
 * the paneless card, from a fresh working self-report; a stale report carries none.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-muse-waiting-4569-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const status = require('./status');
const selfreport = require('./selfreport');
const fleet = require('../test-support/fleet');
const { STATE } = status;
test.after(() => { status.setCreatedSource(null); fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true }); });

const cardOf = (name) => status.snapshot().agents.find((a) => a.sessionName === name);

test('#4569 fix 4: the pane card carries the count from a fresh working report', () => {
  fleet.install([fleet.agent('mark', { state: 'working' })]);
  selfreport.record('mark', { state: 'working', auto: true, waiting: { n: 15, yours: 1 } });
  const card = cardOf('mark');
  assert.ok(card, 'the agent is on the board');
  assert.equal(card.state, STATE.WORKING);
  assert.deepEqual(card.waiting, { n: 15, yours: 1 }, 'the pane card dropped the count');
  // CONTROL: a working report with no count carries none.
  selfreport.record('mark', { state: 'working', auto: true });
  assert.equal(cardOf('mark').waiting, null);
});

test('#4569 fix 4: the paneless card (a live agent with a token and no pane) carries it too', () => {
  const sendertoken = require('./sendertoken');
  const liveness = require('./liveness');
  fleet.install([]);
  sendertoken.mint('markbeat');
  try {
    liveness.seen('markbeat', new Date().toISOString());
    selfreport.record('markbeat', { state: 'working', auto: true, waiting: { n: 3, yours: 0 } });
    const card = cardOf('markbeat');
    assert.ok(card, 'the paneless agent is on the board');
    assert.equal(card.state, STATE.WORKING, JSON.stringify(card && { state: card.state, because: card.because }));
    assert.deepEqual(card.waiting, { n: 3, yours: 0 }, 'the paneless card dropped the count');
  } finally { sendertoken.revoke('markbeat'); }
});

test('#4569 fix 4: a stale working report (past the decay) carries no count on the card', () => {
  fleet.install([fleet.agent('markold', { state: 'idle' })]);
  const file = selfreport.fileFor ? selfreport.fileFor('markold') : null;
  selfreport.record('markold', { state: 'working', auto: true, waiting: { n: 5, yours: 1 } });
  assert.deepEqual(cardOf('markold').waiting, { n: 5, yours: 1 }, 'CONTROL: fresh, it shows');
  // Age the report past REPORT_WORKING_DECAY_MS by rewriting its time.
  assert.ok(file, 'selfreport.fileFor is needed to age the report');
  const old = new Date(Date.now() - status.REPORT_WORKING_DECAY_MS - 60000).toISOString();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => { const r = JSON.parse(l); r.at = old; return JSON.stringify(r); });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  assert.equal(cardOf('markold').waiting, null, 'a stale report still showed a queue');
});
