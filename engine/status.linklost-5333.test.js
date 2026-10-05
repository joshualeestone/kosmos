'use strict';
/**
 * #5333 slice 2: a RUNNING agent that has lost its link to Kosmos is shown as such on its card. The session carries the
 * run's sender-token instance (@kosmos_token_instance, stamped by the supervisor); the card's `linkLost` is true when
 * this board's token file for the agent is there without that run's token (a retire, even of its last token, or the run
 * replaced), so every verb the agent runs is refused. A missing file (a revoke, a wiped store, another board's store)
 * and an unreadable one read 'unknown' and are never flagged.
 */

// ⚠️ SANDBOX FIRST, BEFORE ANY REQUIRE (store.js and engine/status resolve their roots at load), as sendertoken.test.js.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-linklost-5333-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const sendertoken = require('./sendertoken');

test.after(() => {
  fleet.restore();
  fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 5 });
});

const cardOf = (board, name) => board.agents.find((a) => a.sessionName === name);

test('#5333: instanceState answers held, gone, or unknown, and never reads an unreadable store as gone', () => {
  const minted = sendertoken.mint('ivy');
  assert.equal(minted.ok, true);
  assert.equal(sendertoken.instanceState('ivy', minted.instance), 'held');
  assert.equal(sendertoken.instanceState('ivy', 'abcdef123456'), 'gone', 'a run whose token is not on file');
  assert.equal(sendertoken.instanceState('nobody-here', minted.instance), 'unknown', 'no file for this agent (another board\'s store, a revoke): not ours to call lost');
  assert.equal(sendertoken.instanceState('ivy', ''), 'unknown', 'no instance to compare');
  const DIR = sendertoken.DIR; const aside = DIR + '.aside';
  fs.renameSync(DIR, aside);
  try { assert.equal(sendertoken.instanceState('ivy', minted.instance), 'unknown', 'no token store at all: this board never minted, nothing was removed'); }
  finally { fs.renameSync(aside, DIR); }
  assert.equal(sendertoken.instanceState('ivy', 'NOT-HEX'), 'unknown');
  fs.writeFileSync(path.join(sendertoken.DIR, 'ivy.json'), '{not json');
  assert.equal(sendertoken.instanceState('ivy', minted.instance), 'unknown', 'a store file that cannot be read says nothing');
});

test('#5333: a run whose ONLY token is retired is lost (the file stays, empty), and its token is refused like no file', () => {
  const minted = sendertoken.mint('fay');
  const board = fleet.install([fleet.agent('fay', { state: 'idle', tokenInstance: minted.instance })]);
  try {
    assert.equal(sendertoken.live('fay').length, 1, 'precondition: its only token, as #4530 leaves every agent');
    sendertoken.retire('fay', minted.instance);
    assert.ok(fs.existsSync(path.join(sendertoken.DIR, 'fay.json')), 'the file stays, with an empty list');
    assert.deepEqual(sendertoken.live('fay'), []);
    assert.equal(sendertoken.resolve(minted.token, board.roster).ok, false, 'the retired token is refused');
    assert.equal(board.snapshot().find((a) => a.sessionName === 'fay').linkLost, true, 'and the running agent reads as lost');
    sendertoken.retire('fay', minted.instance);   // round 8: a duplicate retire (a second run end, the next launch)
    assert.ok(fs.existsSync(path.join(sendertoken.DIR, 'fay.json')), 'a second retire leaves the empty list in place');
    assert.equal(sendertoken.instanceState('fay', minted.instance), 'gone', 'so the agent still reads as lost, not unknown');
    sendertoken.retire('nobody-at-all', 'abcdef123456');
    assert.equal(fs.existsSync(path.join(sendertoken.DIR, 'nobody-at-all.json')), false, 'CONTROL: a retire never creates a file');
  } finally { board.restore(); }
});

test('#5333: a running agent whose run token is held is not lost; once it is retired, its card says so', () => {
  const minted = sendertoken.mint('ava');
  const board = fleet.install([fleet.agent('ava', { state: 'idle', tokenInstance: minted.instance })]);
  try {
    assert.equal(cardOf(board, 'ava').linkLost, false, 'its token is on file');
    sendertoken.mint('ava');   // another run's token, so the file outlives this run's retire (as a relaunch's sweep leaves it)
    sendertoken.retire('ava', minted.instance);
    const after = board.snapshot();
    assert.equal(after.find((a) => a.sessionName === 'ava').linkLost, true, 'the run is live and its token is gone');
  } finally { board.restore(); }
});

test('#5333: a missing token file (revoked, or another board\'s store) is never read as lost; a replaced run is', () => {
  const minted = sendertoken.mint('bo');
  const board = fleet.install([fleet.agent('bo', { state: 'idle', tokenInstance: minted.instance })]);
  try {
    fs.rmSync(path.join(sendertoken.DIR, 'bo.json'));
    assert.equal(board.snapshot().find((a) => a.sessionName === 'bo').linkLost, false, 'no file: unknown, not lost');
    sendertoken.mint('bo');   // the file is back, holding another run's token only: this run's is gone
    assert.equal(board.snapshot().find((a) => a.sessionName === 'bo').linkLost, true, 'CONTROL: the file without this run\'s token is lost');
  } finally { board.restore(); }
});

test('#5333 CONTROLS: no instance on the session, an unreadable store, or a session Kosmos did not launch is never "lost"', () => {
  const minted = sendertoken.mint('cy');
  sendertoken.mint('di');   // di's file exists, holding a run other than the one its session carries
  const board = fleet.install([
    fleet.agent('cy', { state: 'idle' }),                                         // predates the instance: nothing to compare
    fleet.agent('di', { state: 'idle', tokenInstance: 'abcdef123456' }),          // its file holds another run only: lost
    fleet.agent('ed', { state: 'idle', tokenInstance: minted.instance, ours: false }),    // not ours by name
  ]);
  try {
    assert.equal(cardOf(board, 'cy').linkLost, false, 'no instance stamped');
    assert.equal(cardOf(board, 'di').linkLost, true, 'CONTROL: the same check does fire for an ours session whose token is gone');
    const ed = cardOf(board, 'ed');
    assert.ok(ed, 'CONTROL: the not-ours session has a card to judge');
    assert.equal(ed.isNamedOurs, false, 'precondition: it is not ours by name');
    assert.equal(ed.linkLost, false, 'a session Kosmos did not launch is not ours to judge');
    fs.mkdirSync(sendertoken.DIR, { recursive: true });
    fs.writeFileSync(path.join(sendertoken.DIR, 'di.json'), '{not json');
    assert.equal(board.snapshot().find((a) => a.sessionName === 'di').linkLost, false, 'an unreadable store says nothing');
  } finally { board.restore(); }
});

test('#5333 round 9: a launcher sweep that leaves nothing keeps the empty list, so the live run reads lost; revoke still removes the file', () => {
  const a = sendertoken.mint('gus', { launcher: 'supervisor:gus' });
  assert.deepEqual(sendertoken.retireLauncher('gus', 'supervisor:gus', 'abcdef123456'), { ok: true, retired: 1 }, 'its only token was not the kept run');
  assert.ok(fs.existsSync(path.join(sendertoken.DIR, 'gus.json')), 'the file stays, empty');
  assert.equal(sendertoken.instanceState('gus', 'abcdef123456'), 'gone');
  assert.equal(sendertoken.resolve(a.token, []).ok, false, 'the swept token is refused');
  sendertoken.revoke('gus');
  assert.equal(fs.existsSync(path.join(sendertoken.DIR, 'gus.json')), false, 'CONTROL: revoke still removes it');
});
