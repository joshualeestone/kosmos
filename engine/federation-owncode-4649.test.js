'use strict';
// kosmos#4649: the code that lets another computer of the same account join a project's room.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-owncode-4649-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const federation = require('./federation');
const remote = require('./remote');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('an own code round-trips the project ref and name, and makes the owner link when there is none', () => {
  const code = federation.ownCode('proj-a', 'Weekend plans', 'study');
  assert.ok(code.startsWith(federation.OWN_PREFIX));
  const link = federation.linkFor('proj-a');
  assert.equal(link.role, 'owner', 'a project never shared becomes the owner of its room');
  assert.equal(link.selfShared, true, 'and is marked shared with this account\'s other computers');
  // An owner that already had a guest link keeps its ref and gains the mark.
  federation.recordLink('proj-g', { role: 'owner', ref: 'ref-g' });
  assert.equal(federation.parseOwnCode(federation.ownCode('proj-g', 'G', 'study')).ref, 'ref-g');
  assert.equal(federation.linkFor('proj-g').selfShared, true);
  assert.deepEqual(federation.parseOwnCode('  ' + code + '\n'), { ref: link.ref, name: 'Weekend plans', from: 'study' });
  // Asking again gives the same ref: one room per project.
  assert.equal(federation.parseOwnCode(federation.ownCode('proj-a', 'Weekend plans', 'study')).ref, link.ref);
});

test('a project joined from someone else cannot hand out an own code', () => {
  federation.recordLink('proj-m', { role: 'member', edge_id: 'edge-1' });
  assert.equal(federation.ownCode('proj-m', 'Theirs', 'study'), null);
});

test('anything that is not a well-formed own code is refused', () => {
  const enc = (o) => federation.OWN_PREFIX + Buffer.from(JSON.stringify(o)).toString('base64url');
  for (const bad of [
    '', 'abc.def', 'kosmos-own:', 'kosmos-own:%%%', enc({ v: 3, ref: 'r', name: 'n', from: 'study' }),
    enc({ v: 2, ref: 'r', name: 'n' }), enc({ v: 2, ref: 'r', name: 'n', from: 'Not A Name' }), enc({ v: 2, ref: 'r', name: 'n', from: '-x' }),
    enc({ v: 1, ref: '', name: 'n' }), enc({ v: 1, ref: 'x'.repeat(129), name: 'n' }),
    enc({ v: 1, ref: 'r', name: '   ' }), enc({ v: 1, ref: 'r' }), null, 42,
  ]) assert.equal(federation.parseOwnCode(bad), null, JSON.stringify(bad));
  // The first format named no computer: it still parses (so verify can say why it is refused), with from null.
  assert.deepEqual(federation.parseOwnCode(enc({ v: 1, ref: 'r1', name: 'N' })), { ref: 'r1', name: 'N', from: null });
  assert.deepEqual(federation.parseOwnCode(enc({ v: 2, ref: 'r1', name: 'N', from: 'study' })), { ref: 'r1', name: 'N', from: 'study' });
});

test('the seat arguments: --own-project for an own room, --edge otherwise, never both', () => {
  const own = remote.fedSeatArgs({ own: 'ref-9' });
  assert.equal(own[own.indexOf('--own-project') + 1], 'ref-9');
  assert.ok(!own.includes('--edge'));
  const edge = remote.fedSeatArgs('edge-9');
  assert.equal(edge[edge.indexOf('--edge') + 1], 'edge-9');
  assert.ok(!edge.includes('--own-project'));
  assert.equal(own[0], 'fed-room');
});

test('an owner project that handed out a sealing invite gets no own code (its room is sealed; #4658)', () => {
  federation.recordLink('proj-s', { role: 'owner', ref: 'ref-s' });
  require('./fedseal').stashInvite('ref-s', { s: 'A'.repeat(43), code: 'CODE1', invite: 'inv-1' });
  assert.equal(federation.ownCodeRefusal('proj-s'), 'sealed');
  assert.equal(federation.ownCode('proj-s', 'Sealed', 'study'), null);
  assert.notEqual(federation.linkFor('proj-s').selfShared, true, 'a refused project is not marked shared');
  assert.equal(federation.ownCodeRefusal('proj-m'), 'guest');
  assert.equal(federation.ownCodeRefusal('proj-new'), null);
});

test('an own code always fits under the parse cap, cutting a long name by whole characters', () => {
  // JSON writes a control character as six bytes, so 200 of them overflow the cap uncut.
  const code = federation.ownCode('proj-ctl', 'A' + '\u0007'.repeat(199), 'study');
  const got = federation.parseOwnCode(code);
  assert.ok(got, 'the code parses (length ' + code.length + ')');
  assert.ok(got.name.startsWith('A') && got.name.length < 200, 'the name was cut to fit: ' + got.name.length);
});

test('an invite is refused for a project shared with this account\'s other computers (sealing would lock them out; #4658)', async () => {
  federation.recordLink('proj-ss', { role: 'owner', ref: 'ref-ss', selfShared: true });
  let called = 0;
  const stub = { macRequest: async () => { called += 1; return { ok: true, data: { code: 'C', expires_at: 1, invite_id: 'i' } }; } };
  const out = await federation.invite(stub, { project_ref: 'ref-ss', project_name: 'Mine', invited_kind: 'person' });
  assert.equal(out.status, 409);
  assert.equal(out.body.reason, 'self-shared');
  assert.equal(called, 0, 'nothing was minted');
  assert.equal(require('./fedseal').isSealedRef('ref-ss'), false, 'the room was not sealed');
});

test('an invite takes a project name over 128 bytes (the byte bound is for refs only)', async () => {
  const calls = [];
  const stub = { macRequest: async (method, route, body) => { calls.push(body); return { ok: true, data: { code: 'CODE2', expires_at: 1, invite_id: 'inv-2' } }; } };
  const name = '中'.repeat(60);   // 60 characters, 180 bytes: a legal project name
  const out = await federation.invite(stub, { project_ref: 'ref-cjk', project_name: name, invited_kind: 'person' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(calls[0].project_name, name);
  const refTooLong = await federation.invite(stub, { project_ref: '中'.repeat(43), project_name: 'n', invited_kind: 'person' });
  assert.equal(refTooLong.status, 400, 'a ref over 128 bytes is still refused');
});

test('an own code\'s ref must look like a ref this board mints: it reaches the connector\'s command line', () => {
  const enc = (ref) => federation.OWN_PREFIX + Buffer.from(JSON.stringify({ v: 1, ref, name: 'n' })).toString('base64url');
  for (const bad of ['--coordinator=https://x', '-abc', 'a b', 'a\u0007b', 'a/b', 'a=b'])
    assert.equal(federation.parseOwnCode(enc(bad)), null, JSON.stringify(bad));
  assert.ok(federation.parseOwnCode(enc('0b0c9f2e-1d2a-4c3b-9e8f-000000000001')), 'a UUID is a ref');
});

test('an invite is refused for a project this computer joined by own code (the same room)', async () => {
  federation.recordLink('proj-selfinv', { role: 'self', ref: 'ref-selfinv' });
  let called = 0;
  const stub = { macRequest: async () => { called += 1; return { ok: true, data: { code: 'C', expires_at: 1, invite_id: 'i' } }; } };
  const out = await federation.invite(stub, { project_ref: 'ref-selfinv', project_name: 'Mine', invited_kind: 'person' });
  assert.equal(out.status, 409);
  assert.equal(called, 0);
});

test('an own code made while an invite waits on the coordinator stops that invite before it seals', async () => {
  federation.recordLink('proj-race', { role: 'owner', ref: 'ref-race' });
  const stub = { macRequest: async () => { federation.ownCode('proj-race', 'Race', 'study'); return { ok: true, data: { code: 'C', expires_at: 1, invite_id: 'i' } }; } };
  const out = await federation.invite(stub, { project_ref: 'ref-race', project_name: 'Race', invited_kind: 'person' });
  assert.equal(out.status, 409, JSON.stringify(out.body));
  assert.equal(require('./fedseal').isSealedRef('ref-race'), false, 'the room was not sealed under the other computers');
});

test('an own-code verify with no way to ask about Kosmos Plus is refused (fails closed, like the own-code route)', async () => {
  const code = federation.OWN_PREFIX + Buffer.from(JSON.stringify({ v: 1, ref: 'ref-noplus', name: 'N' })).toString('base64url');
  const out = await federation.verify({ macRequest: async () => ({ ok: false }) }, { code });
  assert.equal(out.status, 403, JSON.stringify(out.body));
  assert.equal(out.body.reason, 'not-plus');
});

/* kosmos#4699: an own code names the computer that made it, and verify accepts it only when that
   computer is on THIS computer's account. */
const ownCodeFrom = (from, ref) => federation.OWN_PREFIX + Buffer.from(JSON.stringify({ v: 2, ref: ref || 'ref-4699', name: 'Shared', from })).toString('base64url');
const plusRemote = (answer) => {
  const calls = [];
  return { calls, kosmosPlus: () => true, macRequest: async (method, route, body) => { calls.push([method, route, body]); return typeof answer === 'function' ? answer() : answer; } };
};
const LIST = (...names) => ({ ok: true, data: { computers: names.map((name) => ({ name, address: name + '.kosmos.test', this: false })) } });

test('#4699: a code without a maker is never made, and nothing is recorded for it', () => {
  for (const bad of [undefined, null, '', 'Not A Name', '-x', 'x'.repeat(64)]) {
    assert.equal(federation.ownCode('proj-nofrom', 'N', bad), null, JSON.stringify(bad));
  }
  assert.equal(federation.linkFor('proj-nofrom'), null, 'a refused code did not mark the project shared');
  assert.equal(federation.ownFromOf('Study.kosmosplus.com'), 'study');
  assert.equal(federation.ownFromOf(null), null);
  assert.equal(federation.ownFromOf('-bad.kosmosplus.com'), null);
});

test('#4699: a code made on one of this account\'s computers is accepted, and the account list is what was asked', async () => {
  const remoteOk = plusRemote(LIST('attic', 'study'));
  const out = await federation.verify(remoteOk, { code: ownCodeFrom('study', 'ref-ok') });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.own, true);
  assert.deepEqual(remoteOk.calls, [['POST', '/v1/mac/account-computers', {}]], 'one signed read of this account\'s computers, and no invite redeemed');
});

test('#4699: the maker is matched on the label of each computer\'s ADDRESS, the way `from` was made, not on its name field', async () => {
  const list = { ok: true, data: { computers: [{ name: 'The Study Mac', address: 'study.kosmos.test', this: false }, { name: 'kitchen', address: 'pantry.kosmos.test', this: false }] } };
  assert.equal((await federation.verify(plusRemote(list), { code: ownCodeFrom('study', 'ref-label-1') })).status, 200, 'a display name that differs from the label refused the account\'s own code');
  const byName = await federation.verify(plusRemote(list), { code: ownCodeFrom('kitchen', 'ref-label-2') });
  assert.equal(byName.body.reason, 'other-account', 'a name field alone is not the computer\'s address');
});

test('#4699: a code from a computer that is not on this account is refused, and nothing is held for a join', async () => {
  const other = plusRemote(LIST('attic', 'kitchen'));
  const out = await federation.verify(other, { code: ownCodeFrom('study', 'ref-other') });
  assert.equal(out.status, 409, JSON.stringify(out.body));
  assert.equal(out.body.reason, 'other-account');
  assert.match(out.body.error, /not on this Kosmos\+ account/);
  assert.equal(federation.joinSnapshot('own:ref-other'), null, 'a refused code left a snapshot a join could use');
  // Control for "nothing is held": the same ref from an account computer IS accepted afterwards.
  const mine = await federation.verify(plusRemote(LIST('study')), { code: ownCodeFrom('study', 'ref-other') });
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
});

test('#4699: when the account\'s computers cannot be read, the code is not accepted on trust', async () => {
  for (const answer of [{ ok: false, because: 'the tunnel is not running' }, { ok: true, data: {} }, () => { throw new Error('spawn failed'); }]) {
    const out = await federation.verify(plusRemote(answer), { code: ownCodeFrom('study', 'ref-unchecked') });
    assert.equal(out.status, 502, JSON.stringify(out.body));
    assert.equal(out.body.reason, 'unchecked');
    assert.match(out.body.error, /could not check/);
  }
});

test('#4699: a could-not-check refusal never shows a path or a route, and names what the person can do', async () => {
  const cases = [
    [{ ok: false, because: 'this computer is not connected to Kosmos+' }, 'no-remote', /Turn on Kosmos\+ remote access/],
    [() => { throw new Error('spawn /Users/someone/Kosmos/bin/kosmos-tunnel ENOENT'); }, 'unchecked', /Try again in a moment/],
    [{ ok: false, because: 'Kosmos+ refused this Mac: this computer is not allowed yet; allow it from your other computer first (HTTP 403 on /v1/mac/account-computers)' }, 'unchecked', /Kosmos\+ said this computer is not allowed yet; allow it from your other computer first\.$/],
  ];
  for (const [answer, reason, words] of cases) {
    const out = await federation.verify(plusRemote(answer), { code: ownCodeFrom('study', 'ref-words') });
    assert.equal(out.body.reason, reason, JSON.stringify(out.body));
    assert.match(out.body.error, words, out.body.error);
    assert.doesNotMatch(out.body.error, /\/|HTTP \d|ENOENT/, 'a path, route or status reached the person: ' + out.body.error);
  }
  // The coordinator's sentence carries no retry advice: retrying cannot allow a computer.
  const held = await federation.verify(plusRemote(cases[2][0]), { code: ownCodeFrom('study', 'ref-words') });
  assert.doesNotMatch(held.body.error, /Try again/);
});

test('#4699: a code in the first format (no maker) is refused with the way forward', async () => {
  const v1 = federation.OWN_PREFIX + Buffer.from(JSON.stringify({ v: 1, ref: 'ref-old', name: 'Old' })).toString('base64url');
  const r = plusRemote(LIST('study'));
  const out = await federation.verify(r, { code: v1 });
  assert.equal(out.status, 409, JSON.stringify(out.body));
  assert.equal(out.body.reason, 'old-code');
  assert.equal(r.calls.length, 0, 'nothing was asked of the coordinator for a code that cannot be checked');
});
