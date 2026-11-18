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
