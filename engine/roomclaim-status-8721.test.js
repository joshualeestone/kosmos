'use strict';
/**
 * kosmos#8721: `kosmos claim <project> <post> --status` asks who holds a post and changes nothing, so an agent that is
 * only checking never ends up holding the claim. react() with claim 'status' writes no row, answers who holds it (or
 * nobody), whether it is the asker's, and how long ago; and it is refused exactly as a claim would be for an agent not
 * on the project or a post that is not there.
 */
require('../test-support/tmpscope');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = path.join(os.tmpdir(), 'kosmos-roomclaim-status-8721-' + process.pid);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const messages = require('./messages');

const MEMBERS = ['ann', 'bob', 'cy'];
function wipeLog() { try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ } }
test.beforeEach(() => { messages.resetForTests(); wipeLog(); });
function seedPost(id) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', id, project: 'p', from: 'you', operator: true, to: [], text: 'can someone do this', outcomes: {}, at: new Date().toISOString() }) + '\n', 'utf8');
}
const ask = (from, mode, of = 'm1', members = MEMBERS) => messages.react({ project: 'p', of, from, members, claim: mode });
const rows = () => messages.record().rows.filter((m) => m.kind === 'reaction').length;

test('status on an unclaimed post: nobody holds it, and nothing is written (CONTROL: a plain claim does write)', () => {
  seedPost('m1');
  const s = ask('bob', 'status');
  assert.deepEqual(s, { ok: true, op: 'status', of: 'm1', mine: false });
  assert.equal(rows(), 0, 'a status check wrote a reaction');
  assert.equal(ask('bob', 'status').op, 'status', 'asked twice, still a read');
  assert.equal(rows(), 0);
  const c = ask('bob', 'claim');
  assert.equal(c.op, 'add');
  assert.equal(rows(), 1, 'CONTROL: the claim itself writes, so the zero above means something');
});

test('status names the holder and how long ago, for the holder (mine) and for anyone else, and changes nothing', () => {
  seedPost('m1');
  ask('ann', 'claim');
  const before = rows();
  const other = ask('bob', 'status');
  assert.equal(other.ok, true);
  assert.equal(other.mine, false);
  assert.equal(other.claimedBy, 'ann');
  assert.equal(other.claimedAge, 'just now');
  const own = ask('ann', 'status');
  assert.equal(own.mine, true);
  assert.equal(own.claimedBy, 'ann');
  assert.equal(rows(), before, 'a status check changed the reactions');
  const c = ask('bob', 'claim');
  assert.equal(c.ok, false, 'CONTROL: ann still holds it after both checks');
  assert.equal(c.claimedBy, 'ann');
});

test('status is refused as a claim would be: not on the project, no such post, a bad mode still refused', () => {
  seedPost('m1');
  assert.equal(ask('zed', 'status').ok, false, 'an agent not on the project read the claim');
  assert.equal(ask('bob', 'status', 'm9').ok, false, 'a post that is not there answered');
  assert.equal(ask('bob', 'peek').ok, false);
  const before = messages.record().rows.filter((m) => m.kind === 'reaction').length;
  const asPerson = messages.react({ project: 'p', of: 'm1', operator: true, claim: 'status' });
  assert.equal(asPerson.ok, false, 'the person\'s branch, which writes, was reached by a status check');
  assert.equal(messages.record().rows.filter((m) => m.kind === 'reaction').length, before);
});

test('a post that asks someone else first: status says so (who, and the minutes left) while nobody holds it', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', id: 'm5', project: 'p', from: 'cy', to: [], mentioned: ['ann'], text: '@ann can you take the login bug?', outcomes: {}, at: new Date().toISOString() }) + '\n', 'utf8');
  const bob = ask('bob', 'status', 'm5');
  assert.equal(bob.ok, true);
  assert.deepEqual(bob.askedOf, ['ann']);
  assert.equal(bob.askedWho, 'ann');
  assert.ok(bob.askedMinutes >= 29 && bob.askedMinutes <= 30, String(bob.askedMinutes));
  const c = ask('bob', 'claim', 'm5');
  assert.equal(c.ok, false, 'CONTROL: bob\'s claim is refused, so the status line above is true');
  assert.deepEqual(c.askedOf, ['ann']);
  const ann = ask('ann', 'status', 'm5');
  assert.equal(ann.askedOf, undefined, 'the asked member is not told the post asks someone else first');
});

test('a refused check from an agent not on the project never names the holder', () => {
  seedPost('m1');
  ask('ann', 'claim');
  const z = ask('zed', 'status');
  assert.equal(z.ok, false);
  assert.equal(z.claimedBy, undefined);
  assert.doesNotMatch(JSON.stringify(z), /ann/);
});

test('status agrees with a claim once the asked hold opens: the asked member gave it back, or the window has passed', () => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  const asked = (id, at) => fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', id, project: 'p', from: 'cy', to: [], mentioned: ['ann'], text: '@ann can you take this?', outcomes: {}, at }) + '\n', 'utf8');
  // Given back: ann claimed it and released it herself, so it is open to bob.
  asked('m6', new Date().toISOString());
  assert.equal(ask('ann', 'claim', 'm6').op, 'add');
  assert.equal(ask('ann', 'release', 'm6').op, 'remove');
  const freed = ask('bob', 'status', 'm6');
  assert.equal(freed.askedOf, undefined, 'status still says the post asks ann after she gave it back');
  assert.equal(freed.claimedBy, undefined);
  assert.equal(ask('bob', 'claim', 'm6').op, 'add', 'CONTROL: bob\'s claim now lands, so the status line is true');
  // Aged: posted an hour ago, past the 30 minute window, nobody claimed it.
  asked('m7', new Date(Date.now() - 60 * 60000).toISOString());
  const aged = ask('bob', 'status', 'm7');
  assert.equal(aged.askedOf, undefined, 'status still says the post asks ann after the window passed');
  assert.equal(ask('bob', 'claim', 'm7').op, 'add', 'CONTROL: bob\'s claim lands after the window');
});
