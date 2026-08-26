'use strict';

// Sandbox the store BEFORE requiring anything: store.js resolves its root at
// module load, the same rule selfreport.test.js states at its own top.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-sendertoken-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const sendertoken = require('./sendertoken');

/* A Windows agent, or an SDK runner: a real roster row with NO pane and no
   tmux session behind it. That absence is the whole point of these tests. */
const tied = (sessionName) => ({ sessionName, name: sessionName, isNamedOurs: true });

test('an agent with no pane resolves by the token it was handed at launch', () => {
  const minted = sendertoken.mint('renet-windows');
  assert.equal(minted.ok, true);
  const who = sendertoken.resolve(minted.token, [tied('renet-windows')]);
  assert.equal(who.ok, true);
  assert.equal(who.card.sessionName, 'renet-windows');
});

test('the body still cannot name the sender: an unissued token is refused, not believed', () => {
  const who = sendertoken.resolve('a'.repeat(64), [tied('renet-windows')]);
  assert.equal(who.ok, false);
  assert.match(who.because, /could not match that to one of your agents/);
});

test('presenting nothing fails with its own sentence, so a caller can tell it forgot the token', () => {
  const who = sendertoken.resolve('', [tied('renet-windows')]);
  assert.equal(who.ok, false);
  assert.match(who.because, /no sender token was presented/);
});

test('the roster tie decides, not the token: an untied row cannot speak even holding a real token', () => {
  const minted = sendertoken.mint('borrowed-name');
  const who = sendertoken.resolve(minted.token, [{ sessionName: 'borrowed-name', isNamedOurs: false }]);
  assert.equal(who.ok, false);
  assert.match(who.because, /could not match that to one of your agents/);
});

test('a revoked token stops resolving, which is how a deleted agent stops being able to speak', () => {
  const minted = sendertoken.mint('going-away');
  assert.equal(sendertoken.resolve(minted.token, [tied('going-away')]).ok, true);
  sendertoken.revoke('going-away');
  assert.equal(sendertoken.resolve(minted.token, [tied('going-away')]).ok, false);
});

test('minting rotates: a recreated agent does not inherit the old one\'s ability to speak', () => {
  const first = sendertoken.mint('recreated');
  const second = sendertoken.mint('recreated');
  assert.notEqual(first.token, second.token);
  assert.equal(sendertoken.resolve(first.token, [tied('recreated')]).ok, false);
  assert.equal(sendertoken.resolve(second.token, [tied('recreated')]).ok, true);
});

test('one agent\'s token never resolves to another, which is the impersonation the pane id allows', () => {
  const mine = sendertoken.mint('agent-one');
  const roster = [tied('agent-one'), tied('agent-two')];
  const who = sendertoken.resolve(mine.token, roster);
  assert.equal(who.card.sessionName, 'agent-one');
});

test('a stale token file with no roster row reads exactly like a token we never issued', () => {
  const minted = sendertoken.mint('vanished');
  const who = sendertoken.resolve(minted.token, [tied('someone-else')]);
  assert.equal(who.ok, false);
  /* Not "that agent is gone": that sentence would confirm the token was
     once real, which is a yes/no oracle for anything guessing. */
  assert.match(who.because, /could not match that to one of your agents/);
});

test('the token is kept owner-only, because it is the agent\'s ability to speak as itself', () => {
  sendertoken.mint('perms-check');
  const file = path.join(sendertoken.DIR, 'perms-check.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
