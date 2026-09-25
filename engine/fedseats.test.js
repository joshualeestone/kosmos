'use strict';
// #3311: the seat manager, driven with a fake connector child and a stub
// coordinator, in a temp data root.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fedseats-3311-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const federation = require('./federation');
const fedseats = require('./fedseats');
test.after(() => { fedseats.stopAll(); fs.rmSync(ROOT, { recursive: true, force: true }); });

function fakeChild() {
  const c = new EventEmitter();
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.written = [];
  c.stdin.on('data', (d) => c.written.push(String(d)));
  return c;
}

function harness({ enrolled = true, edges = null } = {}) {
  const spawned = [];
  const recorded = [];
  const statuses = [];
  fedseats.stopAll();
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); c.edge = edge; spawned.push(c); return c; },
    macRequest: async () => (edges ? { ok: true, data: { as_owner: edges, as_member: [] } } : { ok: false, because: 'no' }),
    recordExternal: (projectId, msg) => recorded.push({ projectId, ...msg }),
    onStatus: (projectId, status) => statuses.push([projectId, status]),
    enrolled: () => enrolled,
  });
  return { spawned, recorded, statuses };
}

const tick = () => new Promise((r) => setImmediate(r));
const say = (child, obj) => child.stdout.write(JSON.stringify(obj) + '\n');

test('a member seat starts on its edge, records deliveries as external data, and posts only when connected', async () => {
  federation.recordLink('proj-m', { role: 'member', edge_id: 'edge-1' });
  const h = harness();
  await fedseats.ensure('proj-m');
  assert.strictEqual(h.spawned.length, 1);
  assert.strictEqual(h.spawned[0].edge, 'edge-1');

  assert.strictEqual(fedseats.post('proj-m', { from: 'Josh', kind: 'person', text: 'too early' }), false, 'not connected yet');
  say(h.spawned[0], { event: 'connected', room: 'r', expires_at: 9 });
  await tick();
  assert.strictEqual(fedseats.statusOf('proj-m'), 'connected');

  assert.strictEqual(fedseats.post('proj-m', { from: '  Josh  ', kind: 'person', text: 'hello out there' }), true);
  await tick();
  assert.deepStrictEqual(JSON.parse(h.spawned[0].written.join('')), { from: 'Josh', kind: 'person', text: 'hello out there' });

  // A delivery is recorded as data; an unreadable or text-less line is not.
  say(h.spawned[0], { event: 'message', data: { from: 'Ada', kind: 'agent', text: 'hi from outside', run: 'rm -rf /' } });
  say(h.spawned[0], { event: 'message', data: { from: 'Ada' } });
  h.spawned[0].stdout.write('not json\n');
  await tick();
  assert.deepStrictEqual(h.recorded, [{ projectId: 'proj-m', from: 'Ada', fromKind: 'agent', text: 'hi from outside' }]);
});

test('exit 3 ends the seat for good; any other exit comes back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  federation.recordLink('proj-e', { role: 'member', edge_id: 'edge-e' });
  federation.recordLink('proj-r', { role: 'member', edge_id: 'edge-r' });
  const h = harness();
  await fedseats.ensure('proj-e');
  await fedseats.ensure('proj-r');
  const [e, r] = h.spawned;
  e.emit('exit', 3);
  r.emit('exit', 1);
  assert.strictEqual(fedseats.statusOf('proj-e'), 'ended');
  assert.strictEqual(fedseats.statusOf('proj-r'), 'reconnecting');
  t.mock.timers.tick(2000);
  await tick(); await tick();
  assert.strictEqual(h.spawned.length, 3, 'only the non-ended seat came back');
  assert.strictEqual(h.spawned[2].edge, 'edge-r');
  await fedseats.ensure('proj-e');
  assert.strictEqual(h.spawned.length, 3, 'an ended seat is not restarted by ensure');
});

test('a connector that cannot start backs off instead of throwing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  federation.recordLink('proj-x', { role: 'member', edge_id: 'edge-x' });
  const h = harness();
  await fedseats.ensure('proj-x');
  h.spawned[0].emit('error', new Error('spawn kosmos-tunnel ENOENT'));
  assert.strictEqual(fedseats.statusOf('proj-x'), 'reconnecting');
});

test('the owner seat uses an active edge of its own project, and waits when there is none', async () => {
  federation.recordLink('proj-o', { role: 'owner', ref: 'ref-o' });
  let h = harness({ edges: [
    { id: 'edge-other', project_ref: 'ref-other', status: 'active' },
    { id: 'edge-gone', project_ref: 'ref-o', status: 'revoked' },
    { id: 'edge-live', project_ref: 'ref-o', status: 'active' },
  ] });
  await fedseats.ensure('proj-o');
  assert.strictEqual(h.spawned.length, 1);
  assert.strictEqual(h.spawned[0].edge, 'edge-live');

  h = harness({ edges: [{ id: 'edge-gone', project_ref: 'ref-o', status: 'revoked' }] });
  assert.strictEqual(await fedseats.ensure('proj-o'), 'waiting');
  assert.strictEqual(h.spawned.length, 0, 'no seat without an active edge');
});

test('nothing starts on a Mac that is not connected to Kosmos+, or for a project with no link', async () => {
  federation.recordLink('proj-n', { role: 'member', edge_id: 'edge-n' });
  let h = harness({ enrolled: false });
  await fedseats.ensure('proj-n');
  assert.strictEqual(h.spawned.length, 0);
  h = harness();
  assert.strictEqual(await fedseats.ensure('proj-unlinked'), null);
  assert.strictEqual(h.spawned.length, 0);
});
