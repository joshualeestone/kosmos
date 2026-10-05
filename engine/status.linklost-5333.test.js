'use strict';
/**
 * #5333 slice 2: a RUNNING agent that has lost its link to Kosmos is shown as such on its card. The session carries the
 * run's sender-token instance (@kosmos_token_instance, stamped by the supervisor); the card's `linkLost` is true when
 * the token store this board reads no longer holds that run's token, so every verb the agent runs is refused. Whatever
 * removed the token (a retire, a revoke, a wiped store), this sees it; an unreadable store is never read as lost.
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
