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
  const code = federation.ownCode('proj-a', 'Weekend plans');
  assert.ok(code.startsWith(federation.OWN_PREFIX));
  const link = federation.linkFor('proj-a');
  assert.equal(link.role, 'owner', 'a project never shared becomes the owner of its room');
  assert.equal(link.selfShared, true, 'and is marked shared with this account\'s other computers');
  // An owner that already had a guest link keeps its ref and gains the mark.
  federation.recordLink('proj-g', { role: 'owner', ref: 'ref-g' });
  assert.equal(federation.parseOwnCode(federation.ownCode('proj-g', 'G')).ref, 'ref-g');
  assert.equal(federation.linkFor('proj-g').selfShared, true);
  assert.deepEqual(federation.parseOwnCode('  ' + code + '\n'), { ref: link.ref, name: 'Weekend plans' });
  // Asking again gives the same ref: one room per project.
  assert.equal(federation.parseOwnCode(federation.ownCode('proj-a', 'Weekend plans')).ref, link.ref);
});

test('a project joined from someone else cannot hand out an own code', () => {
  federation.recordLink('proj-m', { role: 'member', edge_id: 'edge-1' });
  assert.equal(federation.ownCode('proj-m', 'Theirs'), null);
});

test('anything that is not a well-formed own code is refused', () => {
  const enc = (o) => federation.OWN_PREFIX + Buffer.from(JSON.stringify(o)).toString('base64url');
  for (const bad of [
    '', 'abc.def', 'kosmos-own:', 'kosmos-own:%%%', enc({ v: 2, ref: 'r', name: 'n' }),
    enc({ v: 1, ref: '', name: 'n' }), enc({ v: 1, ref: 'x'.repeat(129), name: 'n' }),
    enc({ v: 1, ref: 'r', name: '   ' }), enc({ v: 1, ref: 'r' }), null, 42,
  ]) assert.equal(federation.parseOwnCode(bad), null, JSON.stringify(bad));
  assert.deepEqual(federation.parseOwnCode(enc({ v: 1, ref: 'r1', name: 'N' })), { ref: 'r1', name: 'N' });
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
  assert.equal(federation.ownCode('proj-s', 'Sealed'), null);
  assert.notEqual(federation.linkFor('proj-s').selfShared, true, 'a refused project is not marked shared');
  assert.equal(federation.ownCodeRefusal('proj-m'), 'guest');
  assert.equal(federation.ownCodeRefusal('proj-new'), null);
});

test('an own code always fits under the parse cap, cutting a long name by whole characters', () => {
  // JSON writes a control character as six bytes, so 200 of them overflow the cap uncut.
  const code = federation.ownCode('proj-ctl', 'A' + '\u0007'.repeat(199));
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
