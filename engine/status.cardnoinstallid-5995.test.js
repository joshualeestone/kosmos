'use strict';
/**
 * kosmos#5995: an agent's card carried the install's id. A profile keeps a copy of it (`idInstall`, beside the agent's
 * own id) and the card served the whole profile, to the page and through Kosmos+ to a phone. Nothing reads it there.
 * The card now gets the profile without it. Held here, on the real snapshot, for both ways a card is made (an agent
 * with a pane, and one without), and each time against a control that shows the profile did reach the card and the
 * stored profile still has the id.
 *
 *   node --test engine/status.cardnoinstallid-5995.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cardnoinstallid-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const store = require('./store');
const ping = require('./ping');
const status = require('./status');
const sendertoken = require('./sendertoken');
const liveness = require('./liveness');
const fleet = require('../test-support/fleet');

test('fixture: the install id is this sandbox\'s, and a written profile keeps a copy of it', () => {
  assert.ok(ping.FILE.startsWith(SANDBOX), 'the id file is outside the sandbox: ' + ping.FILE);
  const id = ping.installId();
  assert.match(id, /^[0-9a-f-]{16,}$/i, 'no install id to look for');
  store.writeProfile('mara', { role: 'researcher' });
  assert.equal(store.readProfile('mara').idInstall, id, 'the profile holds no copy, so the tests below would pass with the fix gone');
});

test('#5995: the card of an agent with a pane carries its profile, and not the install id', () => {
  const id = ping.installId();
  store.writeProfile('mara', { role: 'researcher' });
  const board = fleet.install([fleet.agent('mara', { state: 'working' })]);
  try {
    const card = board.card('mara');
    assert.equal(card.paneless, false, 'this is the other kind of card');
    assert.ok(card.profile, 'the card has no profile at all');
    assert.equal(card.profile.role, 'researcher', 'CONTROL: the profile did not reach the card');
    assert.equal(card.profile.id, store.readProfile('mara').id, 'CONTROL: the agent\'s own id is still in it');
    assert.ok(!('idInstall' in card.profile), 'the card\'s profile names the install id');
    assert.ok(!JSON.stringify(status.snapshot()).includes(id), 'the install id is somewhere in what the board serves');
  } finally { board.restore(); }
  assert.equal(store.readProfile('mara').idInstall, id, 'serving the card changed the stored profile');
  assert.equal(store.agentId('mara'), store.readProfile('mara').id, 'the board can no longer tell this agent is this install\'s');
});

test('#5995: the card of an agent with no pane carries its profile, and not the install id', () => {
  const id = ping.installId();
  store.writeProfile('winbox', { role: 'operations' });
  assert.equal(store.readProfile('winbox').idInstall, id, 'the fixture profile holds no copy');
  assert.ok(sendertoken.mint('winbox'), 'the fixture could not mint a token');
  liveness.seen('winbox');
  const board = fleet.install([fleet.agent('mara', { state: 'working' })]);
  try {
    const card = board.card('winbox');
    assert.equal(card.paneless, true, 'this is the other kind of card');
    assert.equal(card.profile.role, 'operations', 'CONTROL: the profile did not reach the card');
    assert.ok(!('idInstall' in card.profile), 'the card\'s profile names the install id');
    assert.ok(!JSON.stringify(status.snapshot()).includes(id), 'the install id is somewhere in what the board serves');
  } finally { board.restore(); }
  assert.equal(store.readProfile('winbox').idInstall, id, 'serving the card changed the stored profile');
});

test('#5995: servedProfile copies, and passes on a profile that is not there', () => {
  const stored = { role: 'pm', id: 'aabbccddeeff', idInstall: 'an-install' };
  const served = store.servedProfile(stored);
  assert.deepEqual(served, { role: 'pm', id: 'aabbccddeeff' });
  assert.equal(stored.idInstall, 'an-install', 'the stored object was changed');
  assert.equal(store.servedProfile(null), null);
  assert.deepEqual(store.servedProfile({}), {});
});
