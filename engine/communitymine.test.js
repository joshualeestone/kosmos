'use strict';
/**
 * #4313: the board's own list of what its agents put in the public community. Reads the
 * send layer's (#4287) records and the board's own published posts; never writes, never
 * carries a key. Sandboxed data root before the require.
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
function writeSent(obj) {
  fs.mkdirSync(path.dirname(cs._paths.sentFile()), { recursive: true });
  fs.writeFileSync(cs._paths.sentFile(), JSON.stringify(obj));
}

test('the state files land under the sandboxed data root', () => {
  assert.ok(cs._paths.sentFile().startsWith(SANDBOX));
});

test('nothing sent yet: an empty list, not an error', () => {
  assert.deepEqual(mine.mine(), []);
});

test('only posts the send layer has a record for are listed, titled from the board post', () => {
  const a = agentPost('ava', { topic: 'Weekly ops', body: 'We moved invoicing to Tuesdays.' });
  agentPost('ava', { topic: 'Never sent', body: 'This one has no record.' });
  writeSent({ [a.id]: { state: 'sent', agent: 'ava', remoteId: 'r1', sentAt: '2026-09-28T08:00:00Z' } });
  const rows = mine.mine();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, a.id);
  assert.equal(rows[0].title, 'Weekly ops');
  assert.equal(rows[0].state, 'sent');
  assert.equal(rows[0].canDelete, true);
});

test('Delete is offered only on a post that is out or about to go, and not twice', () => {
  const ids = ['sent', 'pending', 'asked', 'withheld', 'refused', 'deleted', 'down']
    .map((t) => [t, agentPost('ava', { topic: t, body: t }).id]);
  const id = Object.fromEntries(ids);
  writeSent({
    [id.sent]: { state: 'sent' },
    [id.pending]: { state: 'pending' },
    [id.asked]: { state: 'sent', deleteRequested: true },
    [id.withheld]: { state: 'withheld' },
    [id.refused]: { state: 'refused', reasons: ['email'] },
    [id.deleted]: { state: 'deleted' },
    [id.down]: { state: 'sent', takenDown: true, takeDownReason: 'spam' },
  });
  const can = Object.fromEntries(mine.mine().map((r) => [r.title, r.canDelete]));
  assert.deepEqual(can, { sent: true, pending: true, asked: false, withheld: false, refused: false, deleted: false, down: false });
});

test('deleting through the send layer flips the row off Delete (the same record the sweep acts on)', () => {
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  writeSent({ [a.id]: { state: 'sent', remoteId: 'r1' } });
  assert.equal(mine.mine()[0].canDelete, true);
  assert.equal(cs.requestDelete(a.id).ok, true);
  const row = mine.mine()[0];
  assert.equal(row.deleteRequested, true);
  assert.equal(row.canDelete, false);
});

test('a row carries no key, remote id or send time, whatever the record holds', () => {
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  writeSent({ [a.id]: { state: 'sent', agent: 'ava-session-key', remoteId: 'remote-123', sentAt: '2026-09-28T08:00:00Z' } });
  const row = mine.mine()[0];
  assert.deepEqual(Object.keys(row).sort(),
    ['agent', 'canDelete', 'deleteRequested', 'id', 'postedAt', 'state', 'takeDownReason', 'takenDown', 'title']);
  const text = JSON.stringify(row);
  for (const leak of ['remote-123', 'ava-session-key', '2026-09-28T08:00:00Z']) assert.ok(!text.includes(leak), leak);
});

test('a record whose board post is gone still lists, untitled, so the owner sees it', () => {
  writeSent({ 'gone-1': { state: 'sent' } });
  const rows = mine.mine();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '');
  assert.equal(rows[0].postedAt, null);
});

test("the agent shows by its display name when it has one", () => {
  require('./store').writeProfile('ava', { displayName: 'Ava', role: 'Ops' });
  const a = agentPost('ava', { topic: 'Out', body: 'x' });
  agentPost('bo', { topic: 'Other', body: 'y' });
  writeSent({ [a.id]: { state: 'sent' } });
  assert.equal(mine.mine()[0].agent, 'Ava');
});
