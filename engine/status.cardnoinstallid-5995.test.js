'use strict';
/**
 * kosmos#5995: an agent's card carried the install's id. A profile keeps a copy of it (`idInstall`, beside the agent's
 * own id) and the card served the whole profile, to the page and through Kosmos+ to a phone. Nothing reads it there.
 * So did a stopped agent's row and the answer to a profile save: three exits, found one review at a time. The rule is
 * in engine/store.js now: a profile leaves that file without the install's id, whoever asks. Held here on the store's
 * two doors and on the real snapshot (an agent with a pane, and one without), each against a control that the profile
 * did arrive and the file on disk still has its copy. The real server's answer, a stopped agent's row included, is
 * held in server.agent-id.test.js.
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

/* The record as it is on disk, read here without the store, so a control can show the copy is still kept. */
const onDisk = (name) => JSON.parse(fs.readFileSync(store.profilePath(name), 'utf8'));

test('fixture: the install id is this sandbox\'s, and a written profile keeps a copy of it on disk', () => {
  assert.ok(ping.FILE.startsWith(SANDBOX), 'the id file is outside the sandbox: ' + ping.FILE);
  const id = ping.installId();
  assert.match(id, /^[0-9a-f-]{16,}$/i, 'no install id to look for');
  store.writeProfile('mara', { role: 'researcher' });
  assert.equal(onDisk('mara').idInstall, id, 'the file holds no copy, so the tests below would pass with the rule gone');
});

test('#5995: a profile leaves the store without the install id, read or just written, and the file keeps its copy', () => {
  const id = ping.installId();
  const written = store.writeProfile('mara', { role: 'researcher' });
  const read = store.readProfile('mara');
  for (const [door, p] of [['writeProfile', written], ['readProfile', read]]) {
    assert.equal(p.role, 'researcher', 'CONTROL: ' + door + ' did not answer with the profile');
    assert.equal(p.id, onDisk('mara').id, 'CONTROL: ' + door + ' lost the agent\'s own id');
    assert.ok(!('idInstall' in p), door + ' handed on the install id');
    assert.ok(!JSON.stringify(p).includes(id), door + ' handed on the install id under another name');
  }
  assert.equal(onDisk('mara').idInstall, id, 'the file lost its copy');
  /* The two readers that need the copy still work: this install's agent is told from a copied one, and a second write
     keeps the id it minted (it would mint a new one each time if the stamp no longer saw the copy). */
  assert.equal(store.agentId('mara'), onDisk('mara').id, 'the board can no longer tell this agent is this install\'s');
  const before = onDisk('mara').id;
  store.writeProfile('mara', { role: 'writer' });
  assert.equal(onDisk('mara').id, before, 'a second write minted a new id: the stamp no longer sees the install\'s copy');
  fs.writeFileSync(store.profilePath('copied'), JSON.stringify({ role: 'pm', id: '112233445566', idInstall: 'another-install' }));
  assert.equal(store.agentId('copied'), null, 'CONTROL: an agent copied from another install is spoken for');
  assert.ok(!JSON.stringify(store.readProfile('copied')).includes('another-install'), 'another install\'s id was handed on');
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
    assert.ok(!('idInstall' in card.profile), 'the card\'s profile names the install id');
    assert.ok(!JSON.stringify(status.snapshot()).includes(id), 'the install id is somewhere in what the board serves');
  } finally { board.restore(); }
  assert.equal(onDisk('mara').idInstall, id, 'serving the card changed the stored profile');
});

test('#5995: the card of an agent with no pane carries its profile, and not the install id', () => {
  const id = ping.installId();
  store.writeProfile('mara', { role: 'researcher' });   // the sweep below reads her card too, so this test seeds it itself
  store.writeProfile('winbox', { role: 'operations' });
  assert.equal(onDisk('winbox').idInstall, id, 'the fixture profile holds no copy');
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
  assert.equal(onDisk('winbox').idInstall, id, 'serving the card changed the stored profile');
});

/* What this holds is the store's own exports, nothing wider. Other files open a profile file themselves and parse it
   (doctrine, worldimport, remove, discover, feedbacksend, as of this change); each takes a few named fields or strips
   identity, and none hands the record on. This test cannot see one of them starting to, nor the same helper exported
   under another name. */
test('#5995: the store exports no door to the whole record', () => {
  assert.equal(store.storedProfile, undefined, 'the whole record is exported, so anything can hand it on');
  assert.equal(store.withoutInstallId, undefined);
});
