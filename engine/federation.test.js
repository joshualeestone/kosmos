'use strict';
// #3311: the board's federation calls and link record, with a stub remote so no
// test reaches a coordinator, and a temp data root so none touches a real store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fed-3311-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const store = require('./store');
const federation = require('./federation');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function stubRemote(answer) {
  const calls = [];
  return { calls, macRequest: async (method, route, body) => { calls.push({ method, route, body }); return answer; } };
}

test('invite signs the Mac route with the page fields and returns only the code and expiry', async () => {
  const remote = stubRemote({ ok: true, data: { code: 'CODE123', expires_at: 99, extra: 'x' } });
  const out = await federation.invite(remote, { project_ref: 'ref-1', project_name: 'Book Club', project_desc: 'monthly', invited_kind: 'agent' });
  assert.deepStrictEqual(out, { status: 200, body: { code: 'CODE123', expires_at: 99 } });
  assert.deepStrictEqual(remote.calls, [{ method: 'POST', route: '/v1/mac/federation/invite',
    body: { project_ref: 'ref-1', project_name: 'Book Club', project_desc: 'monthly', invited_kind: 'agent' } }]);
});

test('invite refuses a bad request before calling out', async () => {
  const remote = stubRemote({ ok: true, data: { code: 'x' } });
  for (const bad of [{}, { project_ref: 'r', project_name: 'n', invited_kind: 'boss' }, { project_ref: '', project_name: 'n', invited_kind: 'person' }]) {
    const out = await federation.invite(remote, bad);
    assert.strictEqual(out.status, 400, JSON.stringify(bad));
  }
  assert.strictEqual(remote.calls.length, 0, 'nothing was signed for a bad request');
});

test('invite passes the connector\'s reason through when it fails', async () => {
  const out = await federation.invite(stubRemote({ ok: false, because: 'this computer is not connected to Kosmos+' }),
    { project_ref: 'r', project_name: 'n', invited_kind: 'person' });
  assert.deepStrictEqual(out, { status: 502, body: { error: 'this computer is not connected to Kosmos+' } });
});

test('verify returns the owner snapshot and remembers it for join', async () => {
  const remote = stubRemote({ ok: true, data: { edge_id: 'edge-9', project_name: 'Book Club', project_desc: null, owner_handle: 'reader' } });
  const out = await federation.verify(remote, { code: '  CODE123 ' });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.edge_id, 'edge-9');
  assert.deepStrictEqual(remote.calls[0], { method: 'POST', route: '/v1/mac/federation/verify', body: { code: 'CODE123' } });
  assert.deepStrictEqual(federation.joinSnapshot('edge-9'), { edge_id: 'edge-9', project_name: 'Book Club', project_desc: null, owner_handle: 'reader' });
  assert.strictEqual(federation.joinSnapshot('edge-unknown'), null, 'an edge this board never verified has no snapshot');
  federation.forgetSnapshot('edge-9');
  assert.strictEqual(federation.joinSnapshot('edge-9'), null);
});

test('each coordinator refusal maps to the reason the page words, and an unknown one does not', () => {
  // The coordinator's own sentences, from kosmos-relay coordinator/src/fed.rs.
  const cases = [
    ['that code is not valid. Check it and try again.', 'not-found'],
    ['that code has expired. Ask for a new one.', 'expired'],
    ['that code has already been used. Ask for a new one.', 'already-used'],
    ['you have already joined that project.', 'double-join'],
    ["that is your own project's code; you are already on it.", 'self-join'],
    ['Federation is a Kosmos+ feature. Upgrade to Kosmos+ to invite or join a shared project.', null],
  ];
  for (const [sentence, reason] of cases) assert.strictEqual(federation.reasonFor(sentence), reason, sentence);
});

test('a verify refusal carries its reason and the coordinator sentence', async () => {
  const out = await federation.verify(stubRemote({ ok: false, because: 'that code has expired. Ask for a new one.' }), { code: 'X' });
  assert.deepStrictEqual(out, { status: 409, body: { reason: 'expired', error: 'that code has expired. Ask for a new one.' } });
});

test('the link record round-trips and refuses to overwrite a file it cannot read', () => {
  federation.recordLink('proj-a', { role: 'owner', ref: 'ref-1' });
  assert.deepStrictEqual(federation.linkFor('proj-a'), { role: 'owner', ref: 'ref-1' });
  assert.strictEqual(federation.linkFor('proj-none'), null);
  fs.writeFileSync(path.join(store.ROOT, federation.FILE), '{ not json');
  assert.throws(() => federation.linkFor('proj-a'), (e) => e.code === 'UNREADABLE');
  assert.throws(() => federation.recordLink('proj-b', { role: 'owner', ref: 'r' }), (e) => e.code === 'UNREADABLE');
  assert.strictEqual(fs.readFileSync(path.join(store.ROOT, federation.FILE), 'utf8'), '{ not json', 'the damaged file was left alone');
});
