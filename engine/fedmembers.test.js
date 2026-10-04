'use strict';
// #4649: the owner's invites from an existing project, the Members list from outside, Remove and Withdraw. A stub
// remote answers per route, so no test reaches a coordinator, and a temp data root keeps every record off a real store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fedmembers-4649-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const fedmembers = require('./fedmembers');
const federation = require('./federation');
const fedseal = require('./fedseal');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const DAY = 86400;
/** A remote answering each route from `answers[route]` (a value, or a function of the body); calls are kept. */
function stubRemote(answers) {
  const calls = [];
  return {
    calls,
    routes: () => calls.map((c) => c.route),
    macRequest: async (method, route, body) => {
      calls.push({ method, route, body });
      const a = answers[route];
      return typeof a === 'function' ? a(body) : (a || { ok: false, because: 'no stub for ' + route });
    },
  };
}
let seq = 0;
function inviteAnswer() { seq += 1; return { ok: true, data: { code: 'CODE' + seq, expires_at: Math.floor(Date.now() / 1000) + 7 * DAY, invite_id: 'inv-' + seq } }; }
const here = (ids) => ({ projectExists: (id) => ids.includes(id), projectName: (id) => 'Project ' + id });
function edge(id, ref, inviteId, status = 'active', createdAt = 1000) {
  return { id, invite_id: inviteId, owner_account_id: 'acct-me', project_ref: ref, member_account_id: 'acct-dana', member_kind: 'person', scope: 'messages', status, created_at: createdAt, revoked_at: status === 'active' ? null : createdAt + 5 };
}

test('#4649: inviting from a never-shared project makes and records its owner ref, keeps the owner\'s label here, and returns the invite id', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer });
  assert.strictEqual(federation.linkFor('spring'), null, 'the project was already shared, so this proves nothing');
  const out = await fedmembers.invite(remote, { project: 'spring', invited_kind: 'person', label: '  Dana\u0000 Ruiz  ' }, here(['spring']));
  assert.strictEqual(out.status, 200, JSON.stringify(out));
  assert.ok(out.body.invite_id && out.body.code && out.body.expires_at);
  const link = federation.linkFor('spring');
  assert.strictEqual(link && link.role, 'owner', 'no owner link was recorded, so the board would never seat this room');
  assert.deepStrictEqual(remote.calls[0].body, { project_ref: link.ref, project_name: 'Project spring', invited_kind: 'person' },
    'the coordinator was sent something other than the project\'s ref, its name on this board and the kind (the label must never leave)');
  const rows = fedmembers.rowsFor('spring');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].label, 'Dana Ruiz', 'the label was not cleaned (control characters, spaces)');
  assert.strictEqual(rows[0].invite_id, out.body.invite_id);
  // A second invite reuses the same ref.
  await fedmembers.invite(remote, { project: 'spring', invited_kind: 'agent' }, here(['spring']));
  assert.strictEqual(remote.calls[1].body.project_ref, link.ref, 'a second invite made a new ref, splitting the project into two rooms');
  assert.strictEqual(fedmembers.rowsFor('spring')[1].label, null);
});

test('#4649: a project this board joined, or shares only with its own computers, cannot invite; nothing is signed', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer });
  federation.recordLink('joined', { role: 'member', edge_id: 'e-1', owner_handle: 'maya' });
  federation.recordLink('mine', { role: 'self', ref: 'ref-self', project_name: 'Mine' });
  const a = await fedmembers.invite(remote, { project: 'joined', invited_kind: 'person' }, here(['joined']));
  assert.deepStrictEqual([a.status, a.body.reason], [409, 'not-owner']);
  const b = await fedmembers.invite(remote, { project: 'mine', invited_kind: 'person' }, here(['mine']));
  assert.deepStrictEqual([b.status, b.body.reason], [409, 'self-shared']);
  const c = await fedmembers.invite(remote, { project: 'gone', invited_kind: 'person' }, here([]));
  assert.strictEqual(c.status, 404);
  assert.strictEqual(remote.calls.length, 0, 'the coordinator was asked for an invite that must be refused here');
});

test('#4649: a refused invite leaves a never-shared project unshared and records nothing', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': { ok: false, because: 'this computer is not connected to Kosmos+' } });
  const out = await fedmembers.invite(remote, { project: 'quiet', invited_kind: 'person', label: 'Lee' }, here(['quiet']));
  assert.deepStrictEqual(out, { status: 502, body: { error: 'this computer is not connected to Kosmos+' } });
  assert.strictEqual(federation.linkFor('quiet'), null, 'a refused invite turned the project into a shared one');
  assert.deepStrictEqual(fedmembers.rowsFor('quiet'), []);
});

test('#4649: Members joins this board\'s record with the coordinator\'s connections: pending, joined, removed, expired, withdrawn, newest first', async () => {
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  federation.recordLink('book', { role: 'owner', ref: 'ref-book' });
  const file = path.join(require('./store').ROOT, fedmembers.FILE);
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  all.book = [
    { invite_id: 'i-expired', label: 'Old', kind: 'person', made_at: now - 9 * DAY * 1000, expires_at: sec - DAY },
    { invite_id: 'i-removed', label: 'Sam', kind: 'person', made_at: now - 5000, expires_at: sec + DAY },
    { invite_id: 'i-joined', label: 'Dana Ruiz', kind: 'person', made_at: now - 4000, expires_at: sec + DAY },
    { invite_id: 'i-withdrawn', label: 'Pat', kind: 'agent', made_at: now - 3000, expires_at: sec + DAY, withdrawn_at: now - 100 },
    { invite_id: 'i-pending', label: null, kind: 'agent', made_at: now - 2000, expires_at: sec + DAY },
  ];
  fs.writeFileSync(file, JSON.stringify(all));
  const remote = stubRemote({ '/v1/mac/federation/edges': { ok: true, data: { as_owner: [
    edge('e-joined', 'ref-book', 'i-joined', 'active', 2000),
    edge('e-removed', 'ref-book', 'i-removed', 'revoked', 1500),
    edge('e-other', 'ref-other', 'i-pending', 'active', 1800),   // another project's edge with a colliding id: ignored
  ], as_member: [] } } });
  const out = await fedmembers.members(remote, 'book', now);
  assert.strictEqual(out.status, 200, JSON.stringify(out));
  assert.strictEqual(out.body.owner, true);
  assert.strictEqual(out.body.checked_at, Math.floor(now / 1000));
  assert.deepStrictEqual(out.body.invites.map((r) => [r.invite_id, r.state]), [
    ['i-pending', 'pending'], ['i-withdrawn', 'withdrawn'], ['i-joined', 'joined'], ['i-removed', 'removed'], ['i-expired', 'expired'],
  ]);
  const joined = out.body.invites.find((r) => r.invite_id === 'i-joined');
  assert.deepStrictEqual([joined.edge_id, joined.joined_at, joined.label], ['e-joined', 2000, 'Dana Ruiz']);
  assert.strictEqual(out.body.invites.find((r) => r.invite_id === 'i-pending').edge_id, null, 'another project\'s connection was shown in this list');
  // The coordinator cannot be asked: the record still answers, and says it was not checked.
  const down = await fedmembers.members(stubRemote({}), 'book', now);
  assert.strictEqual(down.status, 200);
  assert.strictEqual(down.body.checked_at, null);
  assert.strictEqual(down.body.invites.length, 5);
  // A project this board joined lists nothing and is not the owner's.
  const asMember = await fedmembers.members(stubRemote({}), 'joined', now);
  assert.deepStrictEqual(asMember.body, { owner: false, invites: [], checked_at: null });
});

test('#4649: Remove revokes only a connection of THIS project, and passes the coordinator\'s refusal through', async () => {
  federation.recordLink('club', { role: 'owner', ref: 'ref-club' });
  const edges = { ok: true, data: { as_owner: [edge('e-club', 'ref-club', 'i-1'), edge('e-elsewhere', 'ref-elsewhere', 'i-2')], as_member: [] } };
  const other = stubRemote({ '/v1/mac/federation/edges': edges, '/v1/mac/federation/revoke': { ok: true, data: { ok: true } } });
  const wrong = await fedmembers.remove(other, 'club', 'e-elsewhere');
  assert.strictEqual(wrong.status, 404);
  assert.ok(!other.routes().includes('/v1/mac/federation/revoke'), 'another project\'s member was revoked from this project\'s screen');
  const ok = await fedmembers.remove(other, 'club', 'e-club');
  assert.deepStrictEqual(ok, { status: 200, body: { removed: true } });
  assert.deepStrictEqual(other.calls.filter((c) => c.route === '/v1/mac/federation/revoke').map((c) => c.body), [{ edge_id: 'e-club' }]);
  const refused = stubRemote({ '/v1/mac/federation/edges': edges, '/v1/mac/federation/revoke': { ok: false, because: 'no active connection to revoke (already removed, or not yours).' } });
  const r = await fedmembers.remove(refused, 'club', 'e-club');
  assert.deepStrictEqual(r, { status: 502, body: { error: 'no active connection to revoke (already removed, or not yours).' } });
  const unchecked = await fedmembers.remove(stubRemote({}), 'club', 'e-club');
  assert.strictEqual(unchecked.status, 502, 'a member was revoked without checking it belongs to this project');
});

test('#4649: Withdraw marks only an invite this project made; a joined code and an older coordinator each get their own answer', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer, '/v1/mac/federation/invite/withdraw': { ok: true, data: { ok: true } } });
  const made = await fedmembers.invite(remote, { project: 'lease', invited_kind: 'person', label: 'Kim' }, here(['lease']));
  const id = made.body.invite_id;
  const unknown = await fedmembers.withdraw(remote, 'lease', 'inv-not-mine');
  assert.strictEqual(unknown.status, 404);
  assert.ok(!remote.routes().includes('/v1/mac/federation/invite/withdraw'), 'a code this project never made was sent to be withdrawn');
  assert.deepStrictEqual(await fedmembers.withdraw(remote, 'lease', id), { status: 200, body: { withdrawn: true } });
  assert.ok(fedmembers.rowsFor('lease').find((r) => r.invite_id === id).withdrawn_at, 'the row was not marked withdrawn');
  const joined = stubRemote({ '/v1/mac/federation/invite/withdraw': { ok: false, because: 'HTTP 409: that invite has already been used' } });
  assert.deepStrictEqual((await fedmembers.withdraw(joined, 'lease', id)).body.reason, 'joined');
  const old = stubRemote({ '/v1/mac/federation/invite/withdraw': { ok: false, because: 'HTTP 404 on /v1/mac/federation/invite/withdraw' } });
  assert.deepStrictEqual((await fedmembers.withdraw(old, 'lease', id)).body.reason, 'unsupported');
});

test('#4649: an invites record that cannot be read is never overwritten; the code still works and says it was not recorded', async () => {
  const file = path.join(require('./store').ROOT, fedmembers.FILE);
  const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
  fs.writeFileSync(file, '{ not json');
  try {
    const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer });
    const out = await fedmembers.invite(remote, { project: 'spring', invited_kind: 'person' }, here(['spring']));
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.body.recorded, false);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json', 'a damaged record was replaced');
    const m = await fedmembers.members(stubRemote({}), 'spring');
    assert.strictEqual(m.status, 500);
  } finally {
    if (before) fs.writeFileSync(file, before); else fs.rmSync(file, { force: true });
  }
});

test('#4649: the label never leaves this computer and is capped', () => {
  assert.strictEqual(fedmembers.cleanLabel('x'.repeat(200)).length, fedmembers.LABEL_MAX);
  assert.strictEqual(fedmembers.cleanLabel('   '), null);
  assert.strictEqual(fedmembers.cleanLabel(42), null);
  assert.strictEqual(fedseal.isSealedRef('ref-never'), false);
});
