'use strict';
/**
 * kosmos#5957 slice 2: status.snapshot() carries rulesBehind on an agent's card, from the real producer (test-support/
 * fleet), so dropping the row's field or its arguments cannot leave both the engine and the page tests green.
 *
 *   node --test engine/status.rulesbehind-5957.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-status-rulesbehind-5957-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const defaults = require('./defaults');
const store = require('./store');
const instructions = require('./instructions');
const status = require('./status');
const fleet = require('../test-support/fleet');
test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const DV = defaults.DOCTRINE_VERSION;
function file(name, display) {
  const f = instructions.fileFor(name);
  fs.mkdirSync(nodePath.dirname(f), { recursive: true });
  fs.writeFileSync(f, `# ${display}\n\nYou are **${display}**, an assistant.\n`);
}

test('#5957: a far-behind agent\'s card carries the number; a recent one carries null (control)', () => {
  fleet.install([
    fleet.agent('stale', { state: 'idle', displayName: 'Stale' }),
    fleet.agent('fresh', { state: 'idle', displayName: 'Fresh' }),
  ]);
  store.writeProfile('stale', { doctrineVersion: DV - 13 });
  store.writeProfile('fresh', { doctrineVersion: DV });
  file('stale', 'Stale');
  file('fresh', 'Fresh');
  const cards = status.snapshot().agents;
  const of = (n) => cards.find((c) => c.sessionName === n) || {};
  assert.equal(of('stale').rulesBehind, 13);
  assert.equal(of('fresh').rulesBehind, null);
  assert.ok('rulesBehind' in of('fresh'), 'the field is missing from the row, not just null');
});

test('#5957: a created agent with no pane (panelessCard, how a stopped Mac agent reaches the board) carries it too', (t) => {
  store.writeProfile('ghost', { doctrineVersion: DV - 13, displayName: 'Ghost' });
  store.writeProfile('quiet', { doctrineVersion: DV, displayName: 'Quiet' });
  file('ghost', 'Ghost');
  file('quiet', 'Quiet');
  status.setCreatedSource(() => ['ghost', 'quiet']);
  t.after(() => status.setCreatedSource(null));
  const cards = status.snapshot().agents;
  const of = (n) => cards.find((c) => c.sessionName === n);
  assert.ok(of('ghost') && of('quiet'), 'fixture: the created agents are not on the board: ' + cards.map((c) => c.sessionName).join(','));
  assert.equal(of('ghost').rulesBehind, 13);
  assert.equal(of('quiet').rulesBehind, null);
});
