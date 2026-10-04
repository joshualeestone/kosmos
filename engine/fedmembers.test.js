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
    { invite_id: 'i-expired', label: 'Old', kind: 'person', made_at: sec - 9 * DAY, expires_at: sec - DAY },
    { invite_id: 'i-removed', label: 'Sam', kind: 'person', made_at: sec - 500, expires_at: sec + DAY },
    { invite_id: 'i-joined', label: 'Dana Ruiz', kind: 'person', made_at: sec - 400, expires_at: sec + DAY },
    { invite_id: 'i-withdrawn', label: 'Pat', kind: 'agent', made_at: sec - 30, expires_at: sec + DAY, withdrawn_at: sec - 1 },
    { invite_id: 'i-pending', label: null, kind: 'agent', made_at: sec - 20, expires_at: sec + DAY },
  ];
  fs.writeFileSync(file, JSON.stringify(all));
  const remote = stubRemote({ '/v1/mac/federation/edges': { ok: true, data: { as_owner: [
    edge('e-joined', 'ref-book', 'i-joined', 'active', sec - 10),
    edge('e-removed', 'ref-book', 'i-removed', 'revoked', sec - 50),
    edge('e-other', 'ref-other', 'i-pending', 'active', sec - 5),   // another project's edge with a colliding id: ignored
  ], as_member: [] } } });
  const out = await fedmembers.members(remote, 'book', now);
  assert.strictEqual(out.status, 200, JSON.stringify(out));
  assert.strictEqual(out.body.owner, true);
  assert.strictEqual(out.body.checked_at, Math.floor(now / 1000));
  // Newest first by when someone joined, else when the code was made.
  assert.deepStrictEqual(out.body.invites.map((r) => [r.invite_id, r.state]), [
    ['i-joined', 'joined'], ['i-pending', 'pending'], ['i-withdrawn', 'withdrawn'], ['i-removed', 'removed'], ['i-expired', 'expired'],
  ]);
  const joined = out.body.invites.find((r) => r.invite_id === 'i-joined');
  assert.deepStrictEqual([joined.edge_id, joined.joined_at, joined.label], ['e-joined', sec - 10, 'Dana Ruiz']);
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
  assert.deepStrictEqual([ok.status, ok.body], [200, { removed: true }]);
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

test('#4649: a label is cleaned and capped, and an unknown ref reads as not sealed', () => {
  assert.strictEqual(fedmembers.cleanLabel('x'.repeat(200)).length, fedmembers.LABEL_MAX);
  assert.strictEqual(fedmembers.cleanLabel('   '), null);
  assert.strictEqual(fedmembers.cleanLabel(42), null);
  assert.strictEqual(fedseal.isSealedRef('ref-never'), false);
});

test('#4649 review round 1: two invites at once on a never-shared project make ONE ref, not two', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const remote = stubRemote({ '/v1/mac/federation/invite': async () => { await gate; return inviteAnswer(); } });
  const a = fedmembers.invite(remote, { project: 'twice', invited_kind: 'person' }, here(['twice']));
  const b = fedmembers.invite(remote, { project: 'twice', invited_kind: 'agent' }, here(['twice']));
  await new Promise((r) => setImmediate(r));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.deepStrictEqual([ra.status, rb.status], [200, 200]);
  const refs = remote.calls.map((c) => c.body.project_ref);
  assert.strictEqual(refs.length, 2);
  assert.strictEqual(refs[0], refs[1], 'two refs: one of the codes opens a room this board never sits in');
  assert.strictEqual(federation.linkFor('twice').ref, refs[0]);
});

test('#4649: fedmembers.forget drops a project\'s rows and only its own', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer });
  await fedmembers.invite(remote, { project: 'keep', invited_kind: 'person' }, here(['keep']));
  await fedmembers.invite(remote, { project: 'drop', invited_kind: 'person' }, here(['drop']));
  assert.strictEqual(fedmembers.forget('drop'), true);
  assert.deepStrictEqual(fedmembers.rowsFor('drop'), []);
  assert.strictEqual(fedmembers.rowsFor('keep').length, 1);
  assert.strictEqual(fedmembers.forget('never'), false);
});

test('#4649 review round 2: a link recorded by another path while the coordinator answered is never overwritten', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': () => {
    // The own-code route shares the project with this account's other computers meanwhile.
    federation.recordLink('raced', { role: 'self', ref: 'ref-own-code', project_name: 'Raced', selfShared: true });
    return inviteAnswer();
  } });
  const out = await fedmembers.invite(remote, { project: 'raced', invited_kind: 'person' }, here(['raced']));
  assert.deepStrictEqual([out.status, out.body.reason], [409, 'changed'], JSON.stringify(out));
  assert.strictEqual(out.body.code, undefined, 'a code was handed out for a room this board will not sit in');
  assert.strictEqual(federation.linkFor('raced').ref, 'ref-own-code', 'the own-code link was overwritten, orphaning the computers joined by it');
  assert.deepStrictEqual(fedmembers.rowsFor('raced'), []);
});

test('#4649 review round 3: someone who joined through a code with no row here (the create screen) is still listed, and can be removed', async () => {
  federation.recordLink('created', { role: 'owner', ref: 'ref-created' });
  const edges = { ok: true, data: { as_owner: [edge('e-dana', 'ref-created', 'inv-from-create-screen', 'active', 1700000000)], as_member: [] } };
  const remote = stubRemote({ '/v1/mac/federation/edges': edges, '/v1/mac/federation/revoke': { ok: true, data: { ok: true } } });
  const m = await fedmembers.members(remote, 'created');
  assert.deepStrictEqual(m.body.invites.map((r) => [r.invite_id, r.state, r.edge_id, r.label]), [['inv-from-create-screen', 'joined', 'e-dana', null]],
    'a member who joined through a create-screen code is invisible, so the owner can neither see nor remove them');
  const rm = await fedmembers.remove(remote, 'created', 'e-dana');
  assert.strictEqual(rm.status, 200);
  assert.strictEqual(rm.roomLine, 'You removed them. They no longer get new messages from this room.');
});

test('#4649 review round 3: every stored time is in unix seconds, as expires_at is', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer, '/v1/mac/federation/invite/withdraw': { ok: true, data: { ok: true } } });
  const t0 = Math.floor(Date.now() / 1000);
  const out = await fedmembers.invite(remote, { project: 'units', invited_kind: 'person', label: 'Ana' }, here(['units']));
  await fedmembers.withdraw(remote, 'units', out.body.invite_id);
  const row = fedmembers.rowsFor('units')[0];
  for (const k of ['made_at', 'withdrawn_at']) {
    assert.ok(Math.abs(row[k] - t0) < 5, k + ' is not in seconds: ' + row[k]);
  }
});

test('#4649 review round 3: Remove gives the room line with the owner\'s label, sealed or not', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer, '/v1/mac/federation/revoke': { ok: true, data: { ok: true } } });
  const made = await fedmembers.invite(remote, { project: 'lined', invited_kind: 'person', label: 'Dana Ruiz' }, here(['lined']));
  const ref = federation.linkFor('lined').ref;
  remote.calls.length = 0;
  const r2 = stubRemote({ '/v1/mac/federation/edges': { ok: true, data: { as_owner: [edge('e-l', ref, made.body.invite_id)], as_member: [] } },
    '/v1/mac/federation/revoke': { ok: true, data: { ok: true } } });
  const rm = await fedmembers.remove(r2, 'lined', 'e-l');
  // The invite went through federation.invite, which seals the room (#3728).
  assert.strictEqual(rm.roomLine, 'You removed Dana Ruiz. New messages here are sealed with a new key they do not have.');
});

test('#4649 review round 4: a project name or description longer than the coordinator takes is cut, never refused', async () => {
  const remote = stubRemote({ '/v1/mac/federation/invite': inviteAnswer });
  const out = await fedmembers.invite(remote, { project: 'long', invited_kind: 'person' },
    { projectExists: () => true, projectName: () => 'N'.repeat(500), projectDesc: () => 'D'.repeat(5000) });
  assert.strictEqual(out.status, 200, 'a long description the owner never typed into the invite refused it: ' + JSON.stringify(out));
  assert.strictEqual(remote.calls[0].body.project_desc.length, federation.DESC_MAX);
  assert.strictEqual(remote.calls[0].body.project_name.length, federation.NAME_MAX);
});
