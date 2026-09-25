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

function harness({ enrolled = true, edges = null, exists = () => true, gate = null } = {}) {
  const spawned = [];
  const recorded = [];
  const statuses = [];
  const notes = [];
  const h = { spawned, recorded, statuses, notes, edges, asked: 0 };
  fedseats.stopAll();
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); c.edge = edge; spawned.push(c); return c; },
    macRequest: async () => {
      h.asked += 1;
      if (gate) await gate;
      return h.edges ? { ok: true, data: { as_owner: h.edges, as_member: [] } } : { ok: false, because: 'no' };
    },
    recordExternal: (projectId, msg) => recorded.push({ projectId, ...msg }),
    onStatus: (projectId, status) => statuses.push([projectId, status]),
    enrolled: () => enrolled,
    projectExists: (projectId) => exists(projectId),
    note: (projectId, text) => notes.push({ projectId, text }),
  });
  return h;
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

test('two overlapping ensure calls for an owner start one seat, not two', async () => {
  federation.recordLink('proj-race', { role: 'owner', ref: 'ref-race' });
  let open;
  const gate = new Promise((r) => { open = r; });
  const h = harness({ gate, edges: [{ id: 'edge-race', project_ref: 'ref-race', status: 'active' }] });
  const a = fedseats.ensure('proj-race');
  const b = fedseats.ensure('proj-race');
  open();
  await Promise.all([a, b]);
  assert.strictEqual(h.spawned.length, 1);
  assert.strictEqual(h.asked, 1, 'the second call waits on the first instead of asking the coordinator again');
});

test('an owner seat refused for good looks for another edge instead of ending', async () => {
  federation.recordLink('proj-o2', { role: 'owner', ref: 'ref-o2' });
  const h = harness({ edges: [{ id: 'edge-a', project_ref: 'ref-o2', status: 'active' }] });
  await fedseats.ensure('proj-o2');
  h.edges = [{ id: 'edge-a', project_ref: 'ref-o2', status: 'revoked' }, { id: 'edge-b', project_ref: 'ref-o2', status: 'active' }];
  h.spawned[0].emit('exit', 3);
  assert.strictEqual(fedseats.statusOf('proj-o2'), 'waiting');
  await fedseats.ensure('proj-o2');
  assert.strictEqual(h.spawned.length, 2);
  assert.strictEqual(h.spawned[1].edge, 'edge-b');
});

test('a removed project has its seat stopped and gets no new one', async () => {
  federation.recordLink('proj-del', { role: 'member', edge_id: 'edge-del' });
  let alive = true;
  const h = harness({ exists: () => alive });
  await fedseats.ensure('proj-del');
  assert.strictEqual(h.spawned.length, 1);
  let ended = false;
  h.spawned[0].stdin.on('finish', () => { ended = true; });
  alive = false;
  assert.strictEqual(await fedseats.ensure('proj-del'), null);
  await tick();
  assert.ok(ended, 'the running seat was told to stop');
  assert.strictEqual(fedseats.statusOf('proj-del'), null);
  await fedseats.ensure('proj-del');
  assert.strictEqual(h.spawned.length, 1);
  assert.strictEqual(federation.linkFor('proj-del'), null, 'its link is forgotten too');
});

test('a post that cannot go out, or is refused, is said in the room', async () => {
  federation.recordLink('proj-say', { role: 'member', edge_id: 'edge-say' });
  const h = harness();
  await fedseats.ensure('proj-say');
  assert.strictEqual(fedseats.post('proj-say', { from: 'Josh', kind: 'person', text: 'early' }), false);
  assert.strictEqual(h.notes.length, 1);
  assert.match(h.notes[0].text, /stayed on this computer/);
  say(h.spawned[0], { event: 'refused_post', because: 'too long\u001b[2J' });
  await tick();
  assert.strictEqual(h.notes.length, 2);
  assert.match(h.notes[1].text, /was not sent/);
  assert.ok(!/\u001b/.test(h.notes[1].text), 'no control characters reach the room');
});

test('inbound messages past the per-minute bound are dropped, with one note', async () => {
  federation.recordLink('proj-flood', { role: 'member', edge_id: 'edge-flood' });
  const h = harness();
  await fedseats.ensure('proj-flood');
  const n = fedseats.INBOUND_PER_WINDOW + 25;
  for (let i = 0; i < n; i++) say(h.spawned[0], { event: 'message', data: { from: 'Ada', kind: 'person', text: 'm' + i } });
  say(h.spawned[0], { event: 'message', data: { from: 'Ada', kind: 'person', text: '   ' } });
  await tick();
  assert.strictEqual(h.recorded.length, fedseats.INBOUND_PER_WINDOW);
  assert.strictEqual(h.notes.length, 1);
  assert.match(h.notes[0].text, /not kept/);
});

test('an external sender name loses control characters', async () => {
  federation.recordLink('proj-ctl', { role: 'member', edge_id: 'edge-ctl' });
  const h = harness();
  await fedseats.ensure('proj-ctl');
  say(h.spawned[0], { event: 'message', data: { from: 'A\u001b]0;pwned\u0007da', kind: 'person', text: 'hi' } });
  await tick();
  assert.strictEqual(h.recorded[0].from, 'A ]0;pwned da');
});

test('a post in a project that is not federated says nothing in its room', async () => {
  const h = harness();
  assert.strictEqual(fedseats.post('proj-local-only', { from: 'Josh', kind: 'person', text: 'hi team' }), false);
  assert.strictEqual(h.notes.length, 0);
});

test('inbound past the byte budget is dropped too, with one note', async () => {
  federation.recordLink('proj-bytes', { role: 'member', edge_id: 'edge-bytes' });
  const h = harness();
  await fedseats.ensure('proj-bytes');
  const big = 'x'.repeat(16000);
  for (let i = 0; i < 10; i++) say(h.spawned[0], { event: 'message', data: { from: 'Ada', kind: 'person', text: big } });
  await tick();
  assert.strictEqual(h.recorded.length, Math.floor(fedseats.INBOUND_BYTES_PER_WINDOW / (big.length + 3)));
  assert.ok(h.recorded.length < 10);
  assert.strictEqual(h.notes.length, 1);
});

test('an owner edge refused for good is not tried again', async () => {
  federation.recordLink('proj-ref', { role: 'owner', ref: 'ref-ref' });
  const h = harness({ edges: [{ id: 'edge-bad', project_ref: 'ref-ref', status: 'active' }] });
  await fedseats.ensure('proj-ref');
  assert.strictEqual(h.spawned.length, 1);
  h.spawned[0].emit('exit', 3);
  assert.strictEqual(await fedseats.ensure('proj-ref'), 'waiting', 'the coordinator still lists it, but it was refused');
  assert.strictEqual(h.spawned.length, 1, 'no second spawn on the refused edge');
});

test('while an owner waits for someone to join, a post says exactly that', async () => {
  federation.recordLink('proj-wait', { role: 'owner', ref: 'ref-wait' });
  const h = harness({ edges: [] });
  assert.strictEqual(await fedseats.ensure('proj-wait'), 'waiting');
  assert.strictEqual(fedseats.post('proj-wait', { from: 'Josh', kind: 'person', text: 'anyone?' }), false);
  assert.match(h.notes[0].text, /nobody outside has joined/);
});

test('a seat that ends says why in the room, once, and a later post says it has ended', async () => {
  federation.recordLink('proj-end', { role: 'member', edge_id: 'edge-end' });
  const h = harness();
  await fedseats.ensure('proj-end');
  say(h.spawned[0], { event: 'ended', because: 'that connection has been revoked. Ask to be re-invited.' });
  await tick();
  h.spawned[0].emit('exit', 3);
  const ended = h.notes.filter((n) => n.projectId === 'proj-end' && /no longer connected/.test(n.text));
  assert.equal(ended.length, 1, JSON.stringify(h.notes));
  assert.match(ended[0].text, /revoked/);
  assert.strictEqual(fedseats.post('proj-end', { from: 'x', kind: 'person', text: 'still there?' }), false);
  assert.match(h.notes[h.notes.length - 1].text, /has ended/);
});

test('an inbound message that cannot be saved is said in the room and does not throw', async () => {
  federation.recordLink('proj-disk', { role: 'member', edge_id: 'edge-disk' });
  const h = harness();
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); c.edge = edge; h.spawned.push(c); return c; },
    macRequest: async () => ({ ok: false }),
    recordExternal: () => { throw new Error('ENOSPC: no space left on device'); },
    onStatus: () => {},
    enrolled: () => true,
    projectExists: () => true,
    note: (projectId, text) => h.notes.push({ projectId, text }),
  });
  await fedseats.ensure('proj-disk');
  assert.doesNotThrow(() => fedseats.onEvent('proj-disk', JSON.stringify({ event: 'message', data: { from: 'Ada', text: 'hi' } })));
  assert.ok(h.notes.some((n) => n.projectId === 'proj-disk' && /could not be saved/.test(n.text)), JSON.stringify(h.notes));
});

test('a stream error on the seat\'s output does not take the board down', async () => {
  federation.recordLink('proj-oerr', { role: 'member', edge_id: 'edge-oerr' });
  const h = harness();
  await fedseats.ensure('proj-oerr');
  // An 'error' with no listener throws out of emit.
  assert.doesNotThrow(() => h.spawned[0].stdout.emit('error', new Error('EIO')));
});

test('one check asks Kosmos+ for edges once, however many owner projects are linked', async () => {
  for (const id of ['proj-o1', 'proj-o2', 'proj-o3']) federation.recordLink(id, { role: 'owner', ref: 'ref-' + id });
  const h = harness({ edges: [] });
  await fedseats.ensureAll();
  assert.strictEqual(h.asked, 1, 'asked ' + h.asked + ' times');
  assert.strictEqual(fedseats.statusOf('proj-o3'), 'waiting');
});

test('a stopped seat that does not exit is killed; one that exits is not', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  federation.recordLink('proj-hang', { role: 'member', edge_id: 'edge-hang' });
  federation.recordLink('proj-bye', { role: 'member', edge_id: 'edge-bye' });
  const h = harness();
  await fedseats.ensure('proj-hang');
  await fedseats.ensure('proj-bye');
  const [hung, polite] = h.spawned;
  let killed = [];
  hung.kill = () => killed.push('hung');
  polite.kill = () => killed.push('polite');
  fedseats.stop('proj-hang');
  fedseats.stop('proj-bye');
  polite.emit('exit', 0);
  t.mock.timers.tick(fedseats.STOP_KILL_MS - 1);
  assert.deepStrictEqual(killed, [], 'not before the grace period');
  t.mock.timers.tick(1);
  assert.deepStrictEqual(killed, ['hung']);
});
