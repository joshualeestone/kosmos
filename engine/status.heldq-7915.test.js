'use strict';
/**
 * kosmos#7915: a held report reaches the card the board builds, as stateHeld, from both card builders (snapshot's pane
 * card and panelessCard), so the card word reads "Question held". Real producers (test-support/fleet), each with an
 * unheld control.
 *
 *   node --test engine/status.heldq-7915.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-status-heldq-7915-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const status = require('./status');
const selfreport = require('./selfreport');
const cardlabel = require('./cardlabel');
const recommender = require('./recommender');
const liveness = require('./liveness');
const sendertoken = require('./sendertoken');
const fleet = require('../test-support/fleet');
test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#7915: a pane card from a held report carries stateHeld and reads Question held; an asked one does not', () => {
  const board = fleet.install([fleet.agent('held', { state: 'idle' }), fleet.agent('asked', { state: 'idle' })]);
  const keyOf = (n) => (board.agents.find((c) => c.sessionName === n) || {}).sessionName || n;
  assert.equal(selfreport.record(keyOf('held'), { state: 'needs_you', because: 'Which logo?', held: true, project: 'p1' }).recorded, true);
  assert.equal(selfreport.record(keyOf('asked'), { state: 'needs_you', because: 'Which logo?', project: 'p1' }).recorded, true);
  const cards = status.snapshot().agents;
  const of = (n) => cards.find((c) => c.sessionName === keyOf(n)) || {};
  assert.equal(of('held').state, 'needs_you', 'fixture: the held report reached the card');
  assert.equal(of('held').stateHeld, true);
  assert.equal(cardlabel.labelOf(of('held')), 'Question held');
  assert.equal(of('asked').stateHeld, false, 'CONTROL');
  assert.equal(cardlabel.labelOf(of('asked')), 'Question');
  // The Recommender reads the same card: it would convene peers on the asked question, never on the held one.
  assert.ok(recommender.stuckRow(of('asked')), 'CONTROL: the asked question is one the Recommender may help with');
  assert.equal(recommender.stuckRow(of('held')), null);
  board.restore();
});

test('#7915: an agent with no pane (panelessCard: a launch token and a live beat, as a Windows agent) carries it too', (t) => {
  for (const n of ['ghostheld', 'ghostasked']) {
    store.writeProfile(n, { displayName: n });
    sendertoken.mint(n);
    liveness.seen(n);
  }
  t.after(() => { for (const n of ['ghostheld', 'ghostasked']) sendertoken.revoke(n); });
  assert.equal(selfreport.record('ghostheld', { state: 'needs_you', because: 'Which logo?', held: true }).recorded, true);
  assert.equal(selfreport.record('ghostasked', { state: 'needs_you', because: 'Which logo?' }).recorded, true);
  const cards = status.snapshot().agents;
  const of = (n) => cards.find((c) => c.sessionName === n);
  assert.ok(of('ghostheld') && of('ghostasked'), 'fixture: the paneless agents are not on the board: ' + cards.map((c) => c.sessionName).join(','));
  assert.equal(of('ghostheld').paneless, true, 'fixture: built by panelessCard');
  assert.equal(of('ghostheld').state, 'needs_you', 'fixture: the held report reached the paneless card');
  assert.equal(of('ghostheld').stateHeld, true);
  assert.equal(of('ghostasked').stateHeld, false, 'CONTROL');
});
