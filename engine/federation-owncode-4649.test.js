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
