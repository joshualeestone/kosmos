'use strict';
/**
 * #4313: the board's own list of what its agents put in the public community. Reads the
 * send layer's (#4287) records and the board's own published posts; never writes, never
 * carries a key. Sandboxed data root before the require.
 *
 * Fixtures use only shapes production writes: sent.json records in the forms the sweep
 * writes them (sendPost, settle, sweepDeletes), and deletes through the real
 * communitysend.requestDelete, which is the only writer of deletes.json.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communitymine-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const mine = require('./communitymine');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
test.beforeEach(() => fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true }));

function agentPost(agent, fields) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), ...fields }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}
const writeSent = (obj) => writeJson(cs._paths.sentFile(), obj);
const writeKeys = (obj) => writeJson(cs._paths.keysFile(), obj);
// The sweep's own record shapes (communitysend.sendPost / sweepDeletes).
const SENT = (agent) => ({ state: 'sent', agent, remoteId: 'r-' + agent, sentAt: '2026-09-28T08:00:00Z' });

test('the state files land under the sandboxed data root', () => {
  assert.ok(cs._paths.sentFile().startsWith(SANDBOX));
  assert.ok(cs._paths.deletesFile().startsWith(SANDBOX));
});

test('nothing sent yet: an empty list, not an error', () => {
  assert.deepEqual(mine.mine(), []);
});

test('only posts the send layer has a record for are listed, titled from the board post', () => {
  const a = agentPost('ava', { topic: 'Weekly ops', body: 'We moved invoicing to Tuesdays.' });
  agentPost('ava', { topic: 'Never sent', body: 'This one has no record.' });
  writeSent({ [a.id]: SENT('ava') });
  const rows = mine.mine();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, a.id);
  assert.equal(rows[0].title, 'Weekly ops');
  assert.equal(rows[0].state, 'sent');
  assert.equal(rows[0].canDelete, true);
});

test('Delete is offered on a post that is out or unconfirmed, and on none of the other sent states (pending: below)', () => {
  const id = {};
  for (const t of ['sent', 'unconfirmed', 'refused', 'withheld', 'down', 'refusedAgent']) id[t] = agentPost('ava', { topic: t, body: t }).id;
  writeKeys({ bo: { refused: true } });
  writeSent({
    [id.sent]: SENT('ava'),
    [id.unconfirmed]: { state: 'pending', agent: 'ava', attempted: true, lastStatus: 0 },  // sendPost, no answer
    [id.refused]: { state: 'refused', agent: 'ava', reasons: ['email'] },
    [id.withheld]: { state: 'withheld', agent: 'ava' },
    [id.down]: { ...SENT('ava'), takenDown: true, takeDownReason: 'spam' },
    [id.refusedAgent]: { ...SENT('bo') },                                                   // no key to delete with
  });
  const can = Object.fromEntries(mine.mine().map((r) => [r.title, [r.state, r.canDelete]]));
  assert.deepEqual(can, {
    sent: ['sent', true], unconfirmed: ['unconfirmed', true], refused: ['refused', false],
    withheld: ['withheld', false], down: ['sent', false], refusedAgent: ['sent', false],
  });
});

test('a delete asked for through the send layer turns Delete off at once', () => {
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  writeSent({ [a.id]: SENT('ava') });
  assert.equal(mine.mine()[0].canDelete, true);
  assert.equal(cs.requestDelete(a.id).ok, true);
  const row = mine.mine()[0];
  assert.equal(row.deleteRequested, true);
  assert.equal(row.canDelete, false);
  assert.equal(row.deleteRetrying, false);
});

test('a landed delete keeps deleteRequested (deletes.json is never pruned), and state says deleted', () => {
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  assert.equal(cs.requestDelete(a.id).ok, true);
  writeSent({ [a.id]: { state: 'deleted', agent: 'ava', remoteId: 'r-ava', sentAt: '2026-09-28T08:00:00Z' } }); // sweepDeletes: settle(rec, {state:'deleted'})
  const row = mine.mine()[0];
  assert.equal(row.state, 'deleted');
  assert.equal(row.deleteRequested, true, 'the UI must check state before deleteRequested');
  assert.equal(row.canDelete, false);
});

test('a delete central did not accept yet is marked retrying', () => {
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  assert.equal(cs.requestDelete(a.id).ok, true);
  writeSent({ [a.id]: { ...SENT('ava'), deleteStatus: 503 } });                          // sweepDeletes, no success
  const row = mine.mine()[0];
  assert.equal(row.deleteRetrying, true);
  assert.equal(row.canDelete, false);
});

test('a delete asked for before the post went out lists it as withheld', () => {
  const a = agentPost('ava', { topic: 'Not yet', body: 'x' });
  assert.equal(cs.requestDelete(a.id).ok, true);                                           // no sent record at all
  const row = mine.mine()[0];
  assert.equal(row.id, a.id);
  assert.equal(row.state, 'withheld');
  assert.equal(row.canDelete, false);
});

test('a row carries no remote id, send time or the record\'s own agent field, whatever the record holds', () => {
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  // A record agent different from the post's, so the assertion can tell the record's field
  // from the post's (the agent id itself is not a secret; the row names the agent on purpose).
  writeSent({ [a.id]: { state: 'sent', agent: 'record-only-agent', remoteId: 'remote-123', sentAt: '2026-09-28T08:00:00Z' } });
  const row = mine.mine()[0];
  assert.deepEqual(Object.keys(row).sort(),
    ['agent', 'agentRefused', 'canDelete', 'deleteRequested', 'deleteRetrying', 'id', 'postedAt', 'state', 'takeDownReason', 'takenDown', 'title']);
  const text = JSON.stringify(row);
  for (const leak of ['remote-123', 'record-only-agent', '2026-09-28T08:00:00Z']) assert.ok(!text.includes(leak), leak);
});

test('a record whose board post is gone still lists, untitled, so the owner sees it', () => {
  writeSent({ 'gone-1': SENT('ava') });
  const rows = mine.mine();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '');
  assert.equal(rows[0].postedAt, null);
  // requestDelete answers 404 for an id with no board post, so no Delete is offered.
  assert.equal(rows[0].canDelete, false);
  assert.equal(cs.requestDelete('gone-1').ok, false);
});

test('the agent shows by its display name when it has one', () => {
  require('./store').writeProfile('ava', { displayName: 'Ava', role: 'Ops' });
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  agentPost('bo', { topic: 'Other', body: 'y' });
  writeSent({ [a.id]: SENT('ava') });
  assert.equal(mine.mine()[0].agent, 'Ava');
});

test('a held post that was released later lists by when it went public, not when it came in', async () => {
  const pause = () => new Promise((r) => setTimeout(r, 15));
  // Not trusted: publishPost holds it for review, stamped receivedAt now.
  const held = feedpublish.publishPost({ kind: 'community_post', agent: 'bea', at: new Date().toISOString(), topic: 'Held first', body: 'Waited for review.' }, { agentId: 'bea' });
  assert.equal(held.ok, true, JSON.stringify(held));
  await pause();
  const later = agentPost('ava', { topic: 'Straight out', body: 'Trusted, published at once.' });
  await pause();
  communitystore.releaseHeld(held.id);
  writeSent({ [held.id]: SENT('bea'), [later.id]: SENT('ava') });
  const rows = mine.mine();
  assert.deepEqual(rows.map((r) => r.title), ['Held first', 'Straight out'], 'the released post went public last, so it lists first');
  const released = communitystore.publishedPosts().find((p) => p.id === held.id);
  assert.ok(released && released.releasedAt && released.releasedAt > released.receivedAt, 'CONTROL: the fixture really is held-then-released');
  assert.equal(rows[0].postedAt, released.releasedAt);
});

test('a post waiting for a retry (pending) lists with Delete, and a delete withholds it; a refused agent\'s pending post has none', () => {
  const retry = agentPost('ava', { topic: 'retry', body: 'retry' }).id;
  const refusedPending = agentPost('ava', { topic: 'refusedPending', body: 'refusedPending' }).id;
  writeKeys({ bo: { refused: true } });
  // sendPost's own shapes: a 429 settles with no fields, a 401 records lastStatus; a refused agent is left pending.
  writeSent({
    [retry]: { state: 'pending', agent: 'ava', lastStatus: 429 },
    [refusedPending]: { state: 'pending', agent: 'bo' },
  });
  const by = () => Object.fromEntries(mine.mine().map((r) => [r.title, [r.state, r.canDelete, r.agentRefused]]));
  assert.deepEqual(by(), { retry: ['pending', true, false], refusedPending: ['pending', false, true] });
  assert.equal(cs.requestDelete(retry).ok, true);
  assert.deepEqual(by().retry, ['withheld', false, false], 'a delete on a pending post withholds it: it never goes out');
});
