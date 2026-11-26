'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9011 part 1: the real status.snapshot() puts waitCleared on the card from the agent's own record, on a pane
 * card and on a paneless (created, not running) card. engine/waitcleared-9011.test.js tests the pieces; this tests that
 * they are wired (review round 1: a card fed waitClearedOf(null) would leave every other check green).
 *
 *   node --test engine/status.waitcleared-9011.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-status-waitcleared-9011-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./store');
const selfreport = require('./selfreport');
const status = require('./status');
const fleet = require('../test-support/fleet');
test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const ASK = { state: 'needs_you', by: 'agent', held: true, because: 'May I merge the pull request?' };

test('#9011 a pane card carries what ended the agent\'s own wait; one still waiting carries null (control)', () => {
  fleet.install([
    fleet.agent('ended', { state: 'idle', displayName: 'Ended' }),
    fleet.agent('asking', { state: 'idle', displayName: 'Asking' }),
  ]);
  assert.equal(selfreport.record('ended', ASK).recorded, true);
  assert.equal(selfreport.record('ended', { state: 'idle', by: 'agent' }).recorded, true);
  assert.equal(selfreport.record('asking', ASK).recorded, true);
  const cards = status.snapshot().agents;
  const of = (n) => cards.find((c) => c.sessionName === n) || {};
  assert.ok(of('ended').sessionName, 'fixture: the pane agent is not on the board: ' + cards.map((c) => c.sessionName).join(','));
  assert.equal(of('ended').waitCleared && of('ended').waitCleared.by, 'replaced', JSON.stringify(of('ended').waitCleared));
  assert.equal(of('ended').waitCleared.held, true);
  assert.ok('waitCleared' in of('asking'), 'the field is missing from the card, not just null');
  assert.equal(of('asking').waitCleared, null, 'CONTROL: a wait still standing has ended nothing');
});

test('#9011 a created agent with no pane (panelessCard) carries it too', (t) => {
  store.writeProfile('gone', { displayName: 'Gone' });
  store.writeProfile('still', { displayName: 'Still' });
  assert.equal(selfreport.record('gone', ASK).recorded, true);
  assert.equal(selfreport.record('gone', { state: 'stopped', auto: true }).recorded, true);
  assert.equal(selfreport.record('still', { state: 'stopped', auto: true }).recorded, true);
  status.setCreatedSource(() => ['gone', 'still']);
  t.after(() => status.setCreatedSource(null));
  const cards = status.snapshot().agents;
  const of = (n) => cards.find((c) => c.sessionName === n);
  assert.ok(of('gone') && of('still'), 'fixture: the created agents are not on the board: ' + cards.map((c) => c.sessionName).join(','));
  assert.equal(of('gone').waitCleared && of('gone').waitCleared.by, 'ended', JSON.stringify(of('gone').waitCleared));
  assert.equal(of('still').waitCleared, null, 'CONTROL: a stop with no wait before it ended nothing');
});
