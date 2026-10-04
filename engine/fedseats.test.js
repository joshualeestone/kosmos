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

function harness({ enrolled = true, edges = null, exists = () => true, gate = null, keptOn = undefined, createdAt = () => undefined } = {}) {
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
      if (h.gate || gate) await (h.gate || gate);
      return h.edges ? { ok: true, data: { as_owner: h.edges, as_member: [] } } : { ok: false, because: 'no' };
    },
    recordExternal: (projectId, msg) => recorded.push({ projectId, ...msg }),
    onStatus: (projectId, status) => statuses.push([projectId, status]),
    enrolled: () => enrolled,
    projectExists: (projectId) => exists(projectId),
    externalKeptOn: keptOn,
    projectCreatedAt: (projectId) => createdAt(projectId),
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

test('#4649 an owner SHARED with its other computers sits in its own room even with no guest', async () => {
  federation.recordLink('proj-os', { role: 'owner', ref: 'ref-os', selfShared: true });
  const h = harness({ edges: [] });
  await fedseats.ensure('proj-os');
  assert.strictEqual(h.spawned.length, 1, 'an owner shared with its own computers must be seated');
  assert.deepStrictEqual(h.spawned[0].edge, { own: 'ref-os' });
  // With a guest's active edge it still takes the edge (the same room).
  const h2 = harness({ edges: [{ id: 'edge-os', project_ref: 'ref-os', status: 'active' }] });
  await fedseats.ensure('proj-os');
  assert.strictEqual(h2.spawned[0].edge, 'edge-os');
});

test('#4699 a room shared only with your own computers is never called "the external project" in a room note', async () => {
  // The relay-down line (the card's case): the seat is starting, not connected yet.
  federation.recordLink('proj-far-own', { role: 'owner', ref: 'ref-far-own', selfShared: true });
  federation.recordLink('proj-far-self', { role: 'self', ref: 'ref-far-self' });
  federation.recordLink('proj-far-guest', { role: 'member', edge_id: 'edge-far-guest' });
  const h = harness({ edges: [{ id: 'edge-far-guest', project_ref: 'ref-far-guest', status: 'active' }] });
  for (const id of ['proj-far-own', 'proj-far-self', 'proj-far-guest']) {
    await fedseats.ensure(id);
    assert.strictEqual(fedseats.post(id, { from: 'Josh', kind: 'person', text: 'hello' }), false, id + ': not connected yet');
  }
  const last = (id) => h.notes.filter((n) => n.projectId === id).pop().text;
  assert.match(last('proj-far-own'), /the connection to the other computers in this project is not up right now/);
  assert.match(last('proj-far-self'), /the connection to the other computers in this project is not up right now/);
  assert.doesNotMatch(last('proj-far-own') + last('proj-far-self'), /external project/);
  // Control: a project joined from someone else still says what it is.
  assert.match(last('proj-far-guest'), /the connection to the external project is not up right now/);
  // An owner project shared by own code may ALSO have a guest from another account, and before its seat
  // is up this computer cannot tell. The words are true with or without one.
  federation.recordLink('proj-far-mixed', { role: 'owner', ref: 'ref-far-mixed', selfShared: true });
  const h2 = harness({ edges: [{ id: 'edge-far-mixed', project_ref: 'ref-far-mixed', status: 'active' }] });
  await fedseats.ensure('proj-far-mixed');
  assert.strictEqual(h2.spawned[h2.spawned.length - 1].edge, 'edge-far-mixed', 'control: seated on the guest\'s edge');
  assert.strictEqual(fedseats.farSide('proj-far-mixed'), 'the other computers in this project');
  assert.strictEqual(fedseats.farSide('proj-far-mixed', true), 'The other computers in this project');
  assert.strictEqual(fedseats.farSide('proj-far-own'), 'the other computers in this project');
  assert.strictEqual(fedseats.farSide('proj-far-self'), 'the other computers in this project');
  assert.strictEqual(fedseats.farSide('proj-far-guest'), 'the external project', 'control: a project joined from someone else');
  federation.recordLink('proj-far-owner-guests', { role: 'owner', ref: 'ref-far-owner-guests' });
  assert.strictEqual(fedseats.farSide('proj-far-owner-guests'), 'the external project', 'control: an owner project shared with guests alone');
  assert.strictEqual(fedseats.farSide('proj-far-no-record'), 'the other computers in this project', 'no record to read: words that are true either way');
});

test('#4649 an owner\'s OWN room refused for good stops seating it and says so once; the project is not ended', async () => {
  federation.recordLink('proj-or', { role: 'owner', ref: 'ref-or', selfShared: true });
  const h = harness({ edges: [] });
  await fedseats.ensure('proj-or');
  assert.strictEqual(h.spawned.length, 1);
  h.spawned[0].emit('exit', 3);
  await tick();
  assert.strictEqual(fedseats.statusOf('proj-or'), 'waiting');
  assert.strictEqual(h.notes.filter((n) => n.projectId === 'proj-or' && /other computers could not be connected/.test(n.text)).length, 1);
  const link = federation.linkFor('proj-or');
  assert.ok(!link.ended, 'the owner\'s project is not ended: a guest can still join it');
  assert.ok(!Array.isArray(link.refused) || link.refused.length === 0, 'no fake edge is filed as refused');
  assert.strictEqual(await fedseats.ensure('proj-or'), 'waiting');
  assert.strictEqual(h.spawned.length, 1, 'the refused own room is not seated again this session');
  // A post that stays local says why in own-room words, not "nobody outside has joined".
  assert.strictEqual(fedseats.post('proj-or', { from: 'Josh', kind: 'person', text: 'hello' }), false);
  const last = h.notes.filter((n) => n.projectId === 'proj-or').pop();
  assert.match(last.text, /not connected to your other computers right now/);
  // The person pressing "Add your other computer" again is an explicit ask: the own room is tried again.
  fedseats.retryOwn('proj-or');
  await fedseats.ensure('proj-or');
  assert.strictEqual(h.spawned.length, 2, 'retried on an explicit ask');
  assert.deepStrictEqual(h.spawned[1].edge, { own: 'ref-or' });
});

test('#4649 an owner\'s own room on a connector too old for it (exit 2) stops, and its guests are still seated', async () => {
  federation.recordLink('proj-old', { role: 'owner', ref: 'ref-old', selfShared: true });
  const h = harness({ edges: [] });
  await fedseats.ensure('proj-old');
  h.spawned[0].emit('exit', 2);
  await tick();
  assert.strictEqual(fedseats.statusOf('proj-old'), 'waiting', 'not ended: the project still takes guests');
  assert.ok(h.notes.some((n) => n.projectId === 'proj-old' && /too old to connect this project to your other computers/.test(n.text)));
  assert.ok(!federation.linkFor('proj-old').ended);
  h.edges = [{ id: 'edge-old', project_ref: 'ref-old', status: 'active' }];
  await fedseats.ensure('proj-old');
  assert.strictEqual(h.spawned.length, 2);
  assert.strictEqual(h.spawned[1].edge, 'edge-old', 'a guest\'s edge is seated after the own room stopped');
});

test('#4649 a self link on a connector too old for its own room (exit 2) waits, and is not ended', async () => {
  federation.recordLink('proj-self2', { role: 'self', ref: 'ref-self2' });
  const h = harness();
  await fedseats.ensure('proj-self2');
  h.spawned[0].emit('exit', 2);
  await tick();
  assert.strictEqual(fedseats.statusOf('proj-self2'), 'waiting');
  assert.ok(h.notes.some((n) => n.projectId === 'proj-self2' && /too old to connect this project to your other computers/.test(n.text)));
  assert.strictEqual(await fedseats.ensure('proj-self2'), 'waiting');
  assert.strictEqual(h.spawned.length, 1);
});

test('#4649 a self link (another computer of the same account) sits in the account\'s own room', async () => {
  federation.recordLink('proj-self', { role: 'self', ref: 'ref-self', project_name: 'Weekend' });
  const h = harness();
  await fedseats.ensure('proj-self');
  assert.strictEqual(h.spawned.length, 1);
  assert.deepStrictEqual(h.spawned[0].edge, { own: 'ref-self' });
  assert.strictEqual(h.asked, 0, 'a self link needs no edge lookup');
  // A refusal (exit 3) stops it for this session, says so, and does NOT end the project:
  // the room is this account's own, so the next start tries again.
  h.spawned[0].emit('exit', 3);
  await tick();
  const link = federation.linkFor('proj-self');
  assert.ok(!link.ended, 'an own seat refused is not ended for good');
  assert.ok(!Array.isArray(link.refused) || link.refused.length === 0, 'an own seat has no edge to refuse');
  assert.strictEqual(fedseats.statusOf('proj-self'), 'waiting');
  assert.ok(h.notes.some((n) => n.projectId === 'proj-self' && /could not be connected to your other computers/.test(n.text)));
  assert.strictEqual(await fedseats.ensure('proj-self'), 'waiting');
  assert.strictEqual(h.spawned.length, 1, 'not seated again this session');
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

test('a seat that connects and drops at once keeps backing off; one that lasted starts over', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  federation.recordLink('proj-flap', { role: 'member', edge_id: 'edge-flap' });
  const h = harness();
  await fedseats.ensure('proj-flap');
  const first = h.spawned[0];
  say(first, { event: 'connected', room: 'r', expires_at: 9 });
  await tick();
  first.emit('exit', 1);          // dropped at once: next wait 2 s, then 4 s
  t.mock.timers.tick(2000);
  await tick(); await tick();
  const second = h.spawned[1];
  assert.ok(second, 'restarted after the first wait');
  say(second, { event: 'connected', room: 'r', expires_at: 9 });
  await tick();
  second.emit('exit', 1);         // dropped at once again: the wait has grown
  t.mock.timers.tick(2000);
  await tick(); await tick();
  assert.strictEqual(h.spawned.length, 2, 'not restarted after only 2 s: the backoff grew');
  t.mock.timers.tick(2000);
  await tick(); await tick();
  const third = h.spawned[2];
  assert.ok(third, 'restarted after 4 s');
  say(third, { event: 'connected', room: 'r', expires_at: 9 });
  await tick();
  t.mock.timers.tick(fedseats.STABLE_MS);   // this one lasted
  third.emit('exit', 1);
  t.mock.timers.tick(2000);
  await tick(); await tick();
  assert.strictEqual(h.spawned.length, 4, 'a connection that lasted resets the wait to 2 s');
});

test('an error from a running seat is not taken as its exit', async () => {
  federation.recordLink('proj-err', { role: 'member', edge_id: 'edge-err' });
  const h = harness();
  await fedseats.ensure('proj-err');
  const c = h.spawned[0];
  c.pid = 4242;
  c.emit('error', new Error('kill EPERM'));
  assert.strictEqual(fedseats.statusOf('proj-err'), 'connecting', 'still the running seat');
});

test('a connector that does not know the verb ends the seat with a note to update', async () => {
  federation.recordLink('proj-old', { role: 'member', edge_id: 'edge-old' });
  const h = harness();
  await fedseats.ensure('proj-old');
  h.spawned[0].emit('exit', 2);
  assert.strictEqual(fedseats.statusOf('proj-old'), 'ended');
  assert.ok(h.notes.some((n) => n.projectId === 'proj-old' && /too old/.test(n.text)), JSON.stringify(h.notes));
});

test('a member seat ended for good stays ended after a restart, with no new seat and no new note', async () => {
  federation.recordLink('proj-gone', { role: 'member', edge_id: 'edge-gone' });
  let h = harness();
  await fedseats.ensure('proj-gone');
  say(h.spawned[0], { event: 'ended', because: 'that connection has been revoked. Ask to be re-invited.' });
  await tick();
  h.spawned[0].emit('exit', 3);
  assert.match(String(federation.linkFor('proj-gone').ended), /revoked/);
  h = harness();                                  // a board restart
  assert.strictEqual(await fedseats.ensure('proj-gone'), 'ended');
  assert.strictEqual(h.spawned.length, 0, 'no seat started');
  assert.strictEqual(h.notes.filter((n) => n.projectId === 'proj-gone').length, 0, 'no note repeated');
});

test('a reason from the connector loses direction overrides before it reaches the room', async () => {
  federation.recordLink('proj-bidi', { role: 'member', edge_id: 'edge-bidi' });
  const h = harness();
  await fedseats.ensure('proj-bidi');
  say(h.spawned[0], { event: 'ended', because: 'revoked‮.ti deweiver' });
  await tick();
  const n = h.notes.find((x) => x.projectId === 'proj-bidi');
  assert.ok(n, JSON.stringify(h.notes));
  assert.ok(!/[‪-‮⁦-⁩]/.test(n.text), JSON.stringify(n.text));
});

test('an owner whose edge ends gets no member note, and a restart does not retry that edge', async () => {
  federation.recordLink('proj-own', { role: 'owner', ref: 'ref-own' });
  const edges = [{ id: 'edge-gone', project_ref: 'ref-own', status: 'active' }];
  let h = harness({ edges });
  await fedseats.ensure('proj-own');
  say(h.spawned[0], { event: 'ended', because: 'that connection has been revoked. Ask to be re-invited.' });
  await tick();
  h.spawned[0].emit('exit', 3);
  assert.strictEqual(h.notes.filter((n) => n.projectId === 'proj-own').length, 0, JSON.stringify(h.notes));
  assert.deepStrictEqual(federation.linkFor('proj-own').refused, ['edge-gone']);
  h = harness({ edges: [...edges, { id: 'edge-live', project_ref: 'ref-own', status: 'active' }] });   // a board restart
  await fedseats.ensure('proj-own');
  assert.strictEqual(h.spawned.length, 1);
  assert.strictEqual(h.spawned[0].edge, 'edge-live', 'the refused edge is skipped after the restart');
});

test('a peer sending at the minute limit all day is cut off at the day budget, with one note', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-25T00:00:00Z') });
  federation.recordLink('proj-day', { role: 'member', edge_id: 'edge-day' });
  const h = harness();
  await fedseats.ensure('proj-day');
  const text = 'x'.repeat(60 * 1024);                       // under the minute's byte budget
  const perDay = Math.floor(fedseats.INBOUND_BYTES_PER_DAY / text.length);
  for (let i = 0; i < perDay + 5; i++) {
    fedseats.onEvent('proj-day', JSON.stringify({ event: 'message', data: { from: 'Flood', text } }));
    t.mock.timers.tick(61 * 1000);                          // a fresh minute each time
  }
  const kept = h.recorded.filter((r) => r.projectId === 'proj-day').length;
  assert.ok(kept <= perDay, `kept ${kept}, day budget allows ${perDay}`);
  assert.ok(kept >= perDay - 1, `kept ${kept}: the minute bound alone did not stop it`);
  assert.strictEqual(h.notes.filter((n) => n.projectId === 'proj-day' && /in a day/.test(n.text)).length, 1);
});

test('an unreadable link record when a seat exits 3 is a restart, not an ending', async () => {
  federation.recordLink('proj-unread', { role: 'owner', ref: 'ref-unread' });
  const h = harness({ edges: [{ id: 'edge-u', project_ref: 'ref-unread', status: 'active' }] });
  await fedseats.ensure('proj-unread');
  const f = require('path').join(require('./store').ROOT, federation.FILE);
  const before = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, '{ not json');
  try {
    h.spawned[0].emit('exit', 3);
    assert.strictEqual(fedseats.statusOf('proj-unread'), 'reconnecting');
  } finally {
    fs.writeFileSync(f, before);
  }
});

test('a flood the minute bound drops does not spend the room\'s day: the next minute\'s message is kept', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-25T10:00:00Z') });
  federation.recordLink('proj-flood', { role: 'member', edge_id: 'edge-flood' });
  const h = harness();
  await fedseats.ensure('proj-flood');
  const big = 'x'.repeat(30 * 1024);
  for (let i = 0; i < 200; i++) fedseats.onEvent('proj-flood', JSON.stringify({ event: 'message', data: { from: 'Flood', text: big } }));
  const keptInFlood = h.recorded.filter((r) => r.projectId === 'proj-flood').length;
  assert.ok(keptInFlood <= 3, `the minute bound kept ${keptInFlood}`);
  t.mock.timers.tick(61 * 1000);
  fedseats.onEvent('proj-flood', JSON.stringify({ event: 'message', data: { from: 'Grace', text: 'hello, still here' } }));
  assert.ok(h.recorded.some((r) => r.projectId === 'proj-flood' && r.text === 'hello, still here'), 'the dropped flood spent the day for everyone');
});

test('a refusal about this Mac (not the edge) keeps nothing on the link and says to sign in again', async () => {
  federation.recordLink('proj-macl', { role: 'owner', ref: 'ref-macl' });
  federation.recordLink('proj-macm', { role: 'member', edge_id: 'edge-macm' });
  federation.recordLink('proj-macc', { role: 'member', edge_id: 'edge-macc' });   // #4645: the retired answer's other wording
  const h = harness({ edges: [{ id: 'edge-o1', project_ref: 'ref-macl', status: 'active' }] });
  await fedseats.ensure('proj-macl');
  await fedseats.ensure('proj-macm');
  await fedseats.ensure('proj-macc');
  const [owner, member, memberNew] = h.spawned;
  say(owner, { event: 'ended', because: 'Kosmos+ refused this Mac: unknown mac (HTTP 401 on /v1/mac/federation/room-ticket)' });
  say(member, { event: 'ended', because: 'Kosmos+ refused this Mac: this Mac was retired (HTTP 401 on /v1/mac/federation/room-ticket)' });
  say(memberNew, { event: 'ended', because: 'Kosmos+ refused this computer: this computer was retired (HTTP 401 on /v1/mac/federation/room-ticket)' });
  await tick();
  owner.emit('exit', 3);
  member.emit('exit', 3);
  memberNew.emit('exit', 3);
  assert.strictEqual(federation.linkFor('proj-macl').refused, undefined, 'the edge was refused for a Mac-level reason');
  assert.strictEqual(federation.linkFor('proj-macm').ended, undefined, 'the membership was ended for a Mac-level reason');
  assert.strictEqual(fedseats.statusOf('proj-macm'), 'reconnecting', 'a Mac-level refusal is a slow retry, not an ending');
  const notes = h.notes.filter((n) => n.projectId === 'proj-macm');
  assert.ok(notes.some((n) => /Sign in to Kosmos\+ again/.test(n.text)), JSON.stringify(notes));
  assert.ok(!notes.some((n) => /ask the owner/.test(n.text)), 'told to ask for a new code when signing in fixes it');
  assert.strictEqual(federation.linkFor('proj-macc').ended, undefined, '"this computer was retired" ended the membership');
  assert.strictEqual(fedseats.statusOf('proj-macc'), 'reconnecting', '"this computer was retired" was read as a different answer');
  assert.ok(h.notes.some((n) => n.projectId === 'proj-macc' && /Sign in to Kosmos\+ again/.test(n.text)), JSON.stringify(h.notes));
});

test('a real child is handled on close, after its last line, not on exit', async () => {
  federation.recordLink('proj-close', { role: 'member', edge_id: 'edge-close' });
  const h = harness();
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); c.pid = 777; c.edge = edge; h.spawned.push(c); return c; },
    macRequest: async () => ({ ok: false }), recordExternal: () => {}, onStatus: () => {},
    enrolled: () => true, projectExists: () => true, note: (projectId, text) => h.notes.push({ projectId, text }),
  });
  await fedseats.ensure('proj-close');
  const c = h.spawned[0];
  c.emit('exit', 3);                                         // exit first, the reason not read yet
  assert.strictEqual(fedseats.statusOf('proj-close'), 'connecting', 'handled on exit, before the last line');
  say(c, { event: 'ended', because: 'Kosmos+ refused this Mac: unknown mac' });
  await tick();
  c.emit('close', 3);
  assert.strictEqual(fedseats.statusOf('proj-close'), 'reconnecting', 'the late Mac-level reason was not seen');
  assert.strictEqual(federation.linkFor('proj-close').ended, undefined, 'the late reason (Mac-level) was not seen');
});

test('after a Mac-level refusal the seat tries again on its own, and the room is told once, not every retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  federation.recordLink('proj-back', { role: 'member', edge_id: 'edge-back' });
  const h = harness();
  await fedseats.ensure('proj-back');
  for (let round = 0; round < 2; round++) {
    const c = h.spawned[h.spawned.length - 1];
    say(c, { event: 'ended', because: 'Kosmos+ refused this Mac: unknown mac' });
    await tick();
    c.emit('exit', 3);
    t.mock.timers.tick(fedseats.MAC_RETRY_MS);
    await tick(); await tick();
  }
  assert.strictEqual(h.spawned.length, 3, 'the seat did not come back by itself after a Mac-level refusal');
  const notes = h.notes.filter((n) => n.projectId === 'proj-back' && /Sign in to Kosmos\+ again/.test(n.text));
  assert.strictEqual(notes.length, 1, 'the sign-in note repeated on every retry');
  assert.strictEqual(federation.linkFor('proj-back').ended, undefined);
});

test('an owner whose edges request fails is not told nobody joined, and an old connector gets the update note', async () => {
  federation.recordLink('proj-askfail', { role: 'owner', ref: 'ref-askfail' });
  const h = harness();
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); c.edge = edge; h.spawned.push(c); return c; },
    macRequest: async () => ({ ok: false, because: 'mac-request does not sign POST "/v1/mac/federation/edges"' }),
    recordExternal: () => {}, onStatus: () => {}, enrolled: () => true, projectExists: () => true,
    note: (projectId, text) => h.notes.push({ projectId, text }),
  });
  assert.strictEqual(await fedseats.ensure('proj-askfail'), 'reconnecting');
  fedseats.post('proj-askfail', { from: 'you', kind: 'person', text: 'hi' });
  const notes = h.notes.filter((n) => n.projectId === 'proj-askfail').map((n) => n.text);
  assert.ok(!notes.some((t) => /nobody outside has joined/.test(t)), JSON.stringify(notes));
  assert.ok(notes.some((t) => /too old/.test(t)), JSON.stringify(notes));
});

test('the connector\'s own "not set up for Kosmos+" ending is about this Mac: nothing kept, retried', async () => {
  federation.recordLink('proj-notset', { role: 'member', edge_id: 'edge-notset' });
  const h = harness();
  await fedseats.ensure('proj-notset');
  say(h.spawned[0], { event: 'ended', because: 'this Mac is not set up for Kosmos+: no such file' });
  await tick();
  h.spawned[0].emit('exit', 3);
  assert.strictEqual(federation.linkFor('proj-notset').ended, undefined);
  assert.strictEqual(fedseats.statusOf('proj-notset'), 'reconnecting');
});

test('a seat never outlives its link: ensure and ensureAll both stop it', async () => {
  federation.recordLink('proj-orphan', { role: 'member', edge_id: 'edge-orphan' });
  federation.recordLink('proj-orphan2', { role: 'member', edge_id: 'edge-orphan2' });
  const h = harness();
  await fedseats.ensure('proj-orphan');
  await fedseats.ensure('proj-orphan2');
  federation.forgetLink('proj-orphan');
  federation.forgetLink('proj-orphan2');
  await fedseats.ensure('proj-orphan');
  assert.strictEqual(fedseats.statusOf('proj-orphan'), null, 'ensure left a seat running with no link');
  await fedseats.ensureAll();
  assert.strictEqual(fedseats.statusOf('proj-orphan2'), null, 'ensureAll left a seat running with no link');
  const orphans = h.spawned.filter((c) => c.edge === 'edge-orphan' || c.edge === 'edge-orphan2');
  assert.strictEqual(orphans.length, 2, 'fixture: both orphan seats were spawned');
  assert.ok(orphans.every((c) => c.stdin.writableEnded), 'a seat with no link was not let go');
});

test('tiny messages at the minute limit stop at the day row cap', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-25T00:00:00Z') });
  federation.recordLink('proj-rows', { role: 'member', edge_id: 'edge-rows' });
  const h = harness();
  await fedseats.ensure('proj-rows');
  for (let i = 0; i < fedseats.INBOUND_ROWS_PER_DAY + 50; i++) {
    fedseats.onEvent('proj-rows', JSON.stringify({ event: 'message', data: { from: 'Tiny', text: 'x' } }));
    if (i % 50 === 49) t.mock.timers.tick(61 * 1000);
  }
  assert.strictEqual(h.recorded.filter((r) => r.projectId === 'proj-rows').length, fedseats.INBOUND_ROWS_PER_DAY);
});

test('#3311: a connector that ignores SIGTERM is killed with SIGKILL, so a stopped seat never lingers', async () => {
  const { spawn } = require('node:child_process');
  // A child that ignores both stdin closing and SIGTERM, as a hung connector would.
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.stdin.resume(); process.stdin.on('end', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready')"], { stdio: ['pipe', 'pipe', 'ignore'] });
  await new Promise((r) => child.stdout.once('data', r));
  const exited = new Promise((r) => child.once('exit', (code, signal) => r(signal)));
  fedseats.letGo(child, 100);
  const signal = await Promise.race([exited, new Promise((r) => setTimeout(() => r('still running'), 3000))]);
  if (signal === 'still running') { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  assert.strictEqual(signal, 'SIGKILL', 'the connector ignoring SIGTERM was left running');
});

test('#3311: output from a stopped seat never lands in a new seat that reuses the project id', async () => {
  federation.recordLink('proj-reuse', { role: 'member', edge_id: 'edge-old' });
  const h = harness();
  await fedseats.ensure('proj-reuse');
  const old = h.spawned[h.spawned.length - 1];
  say(old, { event: 'connected', room: 'r-old', expires_at: 9 });
  await tick();
  fedseats.stop('proj-reuse');
  // The project is deleted and a new one with the same id is shared again at once.
  federation.recordLink('proj-reuse', { role: 'member', edge_id: 'edge-new' });
  await fedseats.ensure('proj-reuse');
  const fresh = h.spawned[h.spawned.length - 1];
  assert.notStrictEqual(fresh, old, 'fixture: a new child took the project id');
  say(fresh, { event: 'connected', room: 'r-new', expires_at: 9 });
  await tick();
  const before = h.recorded.length;
  // The old child, still dying, flushes a message from its old peer.
  say(old, { event: 'message', data: { from: 'Old Peer', kind: 'person', text: 'from the old room' } });
  await tick();
  assert.strictEqual(h.recorded.length, before, 'a stopped seat\'s message landed in the new room: ' + JSON.stringify(h.recorded.slice(before)));
  // The new child still speaks.
  say(fresh, { event: 'message', data: { from: 'New Peer', kind: 'person', text: 'from the new room' } });
  await tick();
  assert.strictEqual(h.recorded.length, before + 1, 'the current seat\'s message was dropped');
  fedseats.stop('proj-reuse');
});

test('a padded sender name is charged for what is kept, not its raw length', async () => {
  federation.recordLink('proj-padname', { role: 'member', edge_id: 'edge-padname' });
  const h = harness();
  await fedseats.ensure('proj-padname');
  // 10 x 60 KiB of name would be 600 KiB against a 64 KiB minute; only 80
  // characters of each are ever stored, so all ten are kept and nothing is noted.
  const pad = 'P'.repeat(60 * 1024);
  for (let i = 0; i < 10; i++) say(h.spawned[0], { event: 'message', data: { from: pad, kind: 'person', text: 'x' } });
  await tick();
  assert.strictEqual(h.recorded.length, 10, 'a padded name spent the room budget: ' + h.recorded.length + ' of 10 kept');
  assert.strictEqual(h.notes.length, 0);
  assert.strictEqual(h.recorded[0].from.length, 80);
});

// #3844: the day budget survives a restart; the minute note is said once a day.
test('#3844: a peer over the minute rate all day gets one note, not one per minute', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-25T00:00:00Z') });
  federation.recordLink('proj-minutes', { role: 'member', edge_id: 'edge-minutes' });
  const h = harness();
  await fedseats.ensure('proj-minutes');
  for (let w = 0; w < 3; w++) {
    for (let i = 0; i < fedseats.INBOUND_PER_WINDOW + 5; i++) fedseats.onEvent('proj-minutes', JSON.stringify({ event: 'message', data: { from: 'Ada', text: 'w' + w + 'm' + i } }));
    t.mock.timers.tick(61 * 1000);
  }
  const said = h.notes.filter((n) => n.projectId === 'proj-minutes' && /in a minute/.test(n.text));
  assert.strictEqual(said.length, 1, 'notes: ' + JSON.stringify(said));
  assert.strictEqual(h.recorded.filter((r) => r.projectId === 'proj-minutes').length, 3 * fedseats.INBOUND_PER_WINDOW, 'fixture: each window still kept its budget');
  // A new day may say it again.
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  for (let i = 0; i < fedseats.INBOUND_PER_WINDOW + 5; i++) fedseats.onEvent('proj-minutes', JSON.stringify({ event: 'message', data: { from: 'Ada', text: 'd2m' + i } }));
  assert.strictEqual(h.notes.filter((n) => n.projectId === 'proj-minutes' && /in a minute/.test(n.text)).length, 2);
});

test('#3844: a restarted seat starts its day from what the room already kept today', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-25T12:00:00Z') });
  federation.recordLink('proj-restart', { role: 'member', edge_id: 'edge-restart' });
  const asked = [];
  const h = harness({ keptOn: (id, day) => { asked.push([id, day]); return { rows: fedseats.INBOUND_ROWS_PER_DAY - 3, bytes: 0 }; } });
  await fedseats.ensure('proj-restart');
  for (let i = 0; i < 10; i++) fedseats.onEvent('proj-restart', JSON.stringify({ event: 'message', data: { from: 'Ada', text: 'r' + i } }));
  assert.strictEqual(h.recorded.filter((r) => r.projectId === 'proj-restart').length, 3, 'a restart gave the room a fresh day');
  assert.deepStrictEqual(asked[0], ['proj-restart', '2026-09-25']);
  assert.ok(h.notes.some((n) => n.projectId === 'proj-restart' && /in a day/.test(n.text)));
});

test('#3844: the byte half of the day is seeded too', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-25T12:00:00Z') });
  federation.recordLink('proj-restart-b', { role: 'member', edge_id: 'edge-restart-b' });
  const h = harness({ keptOn: () => ({ rows: 0, bytes: fedseats.INBOUND_BYTES_PER_DAY - 4 }) });
  await fedseats.ensure('proj-restart-b');
  fedseats.onEvent('proj-restart-b', JSON.stringify({ event: 'message', data: { from: 'Ada', text: 'too long for four bytes' } }));
  assert.strictEqual(h.recorded.filter((r) => r.projectId === 'proj-restart-b').length, 0);
});

test('#3844: a log that cannot be read counts from zero rather than refusing everything', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-25T12:00:00Z') });
  federation.recordLink('proj-unknown-day', { role: 'member', edge_id: 'edge-unknown-day' });
  const h = harness({ keptOn: () => null });
  await fedseats.ensure('proj-unknown-day');
  fedseats.onEvent('proj-unknown-day', JSON.stringify({ event: 'message', data: { from: 'Ada', text: 'hi' } }));
  assert.strictEqual(h.recorded.filter((r) => r.projectId === 'proj-unknown-day').length, 1);
});

// #3851: a link names its project by id, and ids are reused.
test('#3851: a link left by an earlier project of the same id gives the new project no seat, and is dropped', async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    federation.recordLink('proj-reused', { role: 'member', edge_id: 'edge-old', project_created: '2026-09-01T00:00:00.000Z' });
    const h = harness({ createdAt: () => '2026-09-26T00:00:00.000Z' });
    // Before any check runs, a post already treats the room as local: no seat, and
    // no "stayed on this computer" note, which a room read as shared would get.
    assert.strictEqual(fedseats.linkFor('proj-reused'), null, 'the stale link was seen');
    assert.strictEqual(fedseats.post('proj-reused', { from: 'Josh', kind: 'person', text: 'private' }), false);
    assert.strictEqual(h.notes.length, 0, 'the room was treated as shared: ' + JSON.stringify(h.notes));
    await fedseats.ensure('proj-reused');
    assert.strictEqual(h.spawned.length, 0, 'a seat started for a project nobody joined');
    assert.strictEqual(federation.linkFor('proj-reused'), null, 'the stale link was kept');
  } finally {
    console.error = orig;
  }
});

test('#3851: CONTROL: a link stamped for this very project still gets its seat', async () => {
  federation.recordLink('proj-same', { role: 'member', edge_id: 'edge-same', project_created: '2026-09-26T00:00:00.000Z' });
  const h = harness({ createdAt: () => '2026-09-26T00:00:00.000Z' });
  await fedseats.ensure('proj-same');
  assert.strictEqual(h.spawned.length, 1);
  assert.ok(federation.linkFor('proj-same'));
});

test('#3851: a link from before the stamp is stamped on first sight and keeps its seat', async () => {
  federation.recordLink('proj-legacy', { role: 'member', edge_id: 'edge-legacy' });
  const h = harness({ createdAt: () => '2026-09-20T00:00:00.000Z' });
  await fedseats.ensure('proj-legacy');
  assert.strictEqual(h.spawned.length, 1);
  assert.strictEqual(federation.linkFor('proj-legacy').project_created, '2026-09-20T00:00:00.000Z');
});

test('#3851: a project whose createdAt cannot be read decides nothing', async () => {
  federation.recordLink('proj-unknown', { role: 'member', edge_id: 'edge-unknown', project_created: '2026-09-01T00:00:00.000Z' });
  const h = harness({ createdAt: () => undefined });
  await fedseats.ensure('proj-unknown');
  assert.strictEqual(h.spawned.length, 1);
  assert.strictEqual(federation.linkFor('proj-unknown').project_created, '2026-09-01T00:00:00.000Z');
});

test('#3851: a legacy link is stamped with the createdAt the check was made on, read once', async () => {
  federation.recordLink('proj-once', { role: 'member', edge_id: 'edge-once' });
  let reads = 0;
  const h = harness({ createdAt: () => { reads += 1; return reads === 1 ? '2026-09-21T00:00:00.000Z' : undefined; } });
  await fedseats.ensure('proj-once');
  assert.strictEqual(federation.linkFor('proj-once').project_created, '2026-09-21T00:00:00.000Z', 'the stamp came from a second read');
  assert.strictEqual(h.spawned.length, 1);
});

// ---- #3728: sealed rooms, through a real seat and the fake connector ----
const fedseal = require('./fedseal');
const lines = (child) => child.written.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

/** An owner project with one sealing invite made, and its seat connected. */
async function ownerRoom(id, ref, room, invites) {
  for (const inv of invites) fedseal.stashInvite(ref, inv);
  federation.recordLink(id, { role: 'owner', ref });
  const edges = invites.map((inv, i) => ({ id: 'edge-' + inv.invite, project_ref: ref, status: 'active', invite_id: inv.invite }));
  const h = harness({ edges });
  await fedseats.ensure(id);
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room, expires_at: 9 });
  await settle();
  return { h, seat };
}
const newInvite = (tag) => ({ s: fedseal.randomSecret(), code: 'code-' + tag, invite: 'inv-' + tag });

test('#3728: the owner shares the room key with a member who knows the invite, and a stranger gets nothing', async () => {
  const inv = newInvite('so');
  const { h, seat } = await ownerRoom('proj-seal-o', 'ref-seal-o', 'room-so', [inv]);
  const stranger = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(fedseal.randomSecret(), inv.code, stranger, 'room-so') });
  await settle();
  assert.strictEqual(lines(seat).length, 0, 'a stranger was answered');
  const member = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, member, 'room-so') });
  await settle();
  const [share] = lines(seat);
  assert.strictEqual(share && share.t, 'key-share');
  const got = fedseal.openShare(inv.s, inv.code, member, share, 'room-so');
  assert.ok(got, 'the member could not open the owner\'s share');
  assert.strictEqual(got.ownerPub, fedseal.sealingKey().pub);
  assert.deepStrictEqual(fedseal.pendingInvites('ref-seal-o'), [], 'the invite was not spent');
  // Pinned to the edge the COORDINATOR lists for that invite, not to anything the member said.
  assert.strictEqual(fedseal.roomState('proj-seal-o').peers[member.pub].edge, 'edge-inv-so');
  assert.strictEqual(h.recorded.length, 0, 'a key frame was recorded as a row');
  assert.strictEqual(fedseats.post('proj-seal-o', { from: 'Josh', kind: 'person', text: 'secret words' }), true);
  const out = lines(seat).pop();
  assert.ok(fedseal.isSealed(out) && !JSON.stringify(out).includes('secret words'), 'the post left in the clear: ' + JSON.stringify(out));
  assert.strictEqual(fedseal.open({ [got.epoch]: got.roomKey }, 'room-so', out).m.text, 'secret words');
  // The member says hello again (its share was lost): answered from the pin with the same key.
  say(seat, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, member, 'room-so') });
  await settle();
  const again = lines(seat).pop();
  assert.strictEqual(fedseal.openShare(inv.s, inv.code, member, again, 'room-so').roomKey, got.roomKey);
  // A second key presenting the same (spent) invite gets nothing: one key per invite.
  const second = fedseal.newKeyPair();
  const n = lines(seat).length;
  say(seat, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, second, 'room-so') });
  await settle();
  assert.strictEqual(lines(seat).length, n, 'a second key was pinned from one invite');
});

test('#3728: an owner never speaks or listens in the clear once it has made a sealing invite, key or no key yet', async () => {
  const inv = newInvite('oc');
  const { h, seat } = await ownerRoom('proj-seal-oc', 'ref-seal-oc', 'room-oc', [inv]);
  // No hello has arrived (a relay could be dropping them): nothing leaves, and the room says why.
  assert.strictEqual(fedseats.post('proj-seal-oc', { from: 'Josh', kind: 'person', text: 'too early' }), false);
  assert.strictEqual(lines(seat).length, 0, 'the owner posted before any member had a key');
  assert.ok(h.notes.some((n) => /no member's computer has joined with its key yet/.test(n.text)), JSON.stringify(h.notes));
  // Words in the clear from "a member" are not shown either.
  say(seat, { event: 'message', data: { from: 'Mallory', kind: 'person', text: 'injected' } });
  await settle();
  assert.strictEqual(h.recorded.length, 0, 'an injected plaintext row was shown');
});

test('#3728: a member says hello, holds its posts until the key arrives, then seals out and opens in, and refuses a downgrade or a replay', async () => {
  const s = fedseal.randomSecret();
  federation.recordLink('proj-seal-m', { role: 'member', edge_id: 'edge-sm' });
  fedseal.setRoomState('proj-seal-m', { role: 'member', s, code: 'code-m', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-seal-m');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-sm', expires_at: 9 });
  await settle();
  const [hello] = lines(seat);
  const me = fedseal.sealingKey();
  assert.strictEqual(fedseal.checkHello(s, 'code-m', hello, 'room-sm'), me.pub, 'the member did not say a genuine hello');
  assert.strictEqual(fedseats.post('proj-seal-m', { from: 'Ana', kind: 'person', text: 'too early' }), false);
  assert.ok(h.notes.some((n) => /has not shared its key yet/.test(n.text)), JSON.stringify(h.notes));
  assert.strictEqual(lines(seat).length, 1, 'a post went out before the room had a key');
  const owner = fedseal.newKeyPair();
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.shareFrame(s, 'code-m', owner, me.pub, roomKey, 0, 'room-sm') });
  await settle();
  assert.deepStrictEqual(fedseal.roomState('proj-seal-m').keys, { 0: roomKey });
  assert.strictEqual(fedseal.roomState('proj-seal-m').peer, owner.pub);
  assert.strictEqual(fedseats.post('proj-seal-m', { from: 'Ana', kind: 'person', text: 'now sealed' }), true);
  assert.ok(!JSON.stringify(lines(seat).pop()).includes('now sealed'));
  const env = fedseal.seal(roomKey, 0, 'room-sm', { from: 'Owner', kind: 'person', text: 'hello member' });
  say(seat, { event: 'message', data: env });
  await settle();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['hello member']);
  // The same sealed message again (a replay), one sealed an hour and more ago, words in
  // the clear, and a seal this board cannot open: none is shown.
  say(seat, { event: 'message', data: env });
  say(seat, { event: 'message', data: fedseal.seal(roomKey, 0, 'room-sm', { from: 'Owner', kind: 'person', text: 'stale' }, Date.now() - 2 * 3600 * 1000) });
  say(seat, { event: 'message', data: { from: 'Mallory', kind: 'person', text: 'downgrade' } });
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-sm', { from: 'Mallory', kind: 'person', text: 'wrong key' }) });
  await settle();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['hello member'], 'a replayed, stale, downgraded or unopenable message was shown');
  assert.ok(h.notes.some((n) => /arrived a second time/.test(n.text)));
  assert.ok(h.notes.some((n) => /check the date and time/.test(n.text)), 'a message refused on time did not point at the clock');
  assert.ok(h.notes.some((n) => /arrived unsealed/.test(n.text)));
  assert.ok(h.notes.some((n) => /could not open/.test(n.text)));
});

test('#3728: a member still waiting for the key says hello again on each pass (a dropped hello is not a lost room)', async () => {
  const s = fedseal.randomSecret();
  federation.recordLink('proj-rehello', { role: 'member', edge_id: 'edge-rh' });
  fedseal.setRoomState('proj-rehello', { role: 'member', s, code: 'code-rh', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-rehello');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-rh', expires_at: 9 });
  await settle();
  const before = lines(seat).filter((f) => f.t === 'key-hello').length;
  await fedseats.ensureAll();
  assert.strictEqual(lines(seat).filter((f) => f.t === 'key-hello').length, before + 1, 'no second hello on the next pass');
});

test('#3728: a revoked member is rotated out by the edge its invite was redeemed into, whatever it claims', async () => {
  const a = newInvite('ra');
  const b = newInvite('rb');
  const { h, seat } = await ownerRoom('proj-rot', 'ref-rot', 'room-rot', [a, b]);
  const ka = fedseal.newKeyPair();
  const kb = fedseal.newKeyPair();
  // A's hello carries a made-up edge; it is ignored: the pin comes from the coordinator's list.
  say(seat, { event: 'message', data: Object.assign(fedseal.helloFrame(a.s, a.code, ka, 'room-rot'), { edge: 'edge-inv-rb' }) });
  say(seat, { event: 'message', data: fedseal.helloFrame(b.s, b.code, kb, 'room-rot') });
  await settle();
  const peers = fedseal.roomState('proj-rot').peers;
  assert.strictEqual(peers[ka.pub].edge, 'edge-inv-ra', 'A was pinned to the edge it claimed');
  assert.strictEqual(peers[kb.pub].edge, 'edge-inv-rb');
  assert.strictEqual(await fedseats.rotateForRevoked('proj-rot', federation.linkFor('proj-rot'), null), false, 'a rotation with nothing revoked');
  h.edges = [{ id: 'edge-inv-ra', project_ref: 'ref-rot', status: 'revoked', invite_id: 'inv-ra' }, { id: 'edge-inv-rb', project_ref: 'ref-rot', status: 'active', invite_id: 'inv-rb' }];
  const before = lines(seat).length;
  assert.strictEqual(await fedseats.rotateForRevoked('proj-rot', federation.linkFor('proj-rot'), null), true);
  const st = fedseal.roomState('proj-rot');
  assert.strictEqual(st.epoch, 1);
  assert.deepStrictEqual(Object.keys(st.peers), [kb.pub], 'the revoked member is still pinned');
  const rotates = lines(seat).slice(before).filter((f) => f.t === 'key-rotate');
  assert.strictEqual(rotates.length, 1);
  const ownerPub = fedseal.sealingKey().pub;
  assert.deepStrictEqual(fedseal.openRotate(kb, ownerPub, rotates[0], 'room-rot'), { epoch: 1, roomKey: st.keys[1], rotatedAt: st.rotatedAt });
  assert.strictEqual(fedseal.openRotate(ka, ownerPub, rotates[0], 'room-rot'), null);
  assert.strictEqual(fedseats.post('proj-rot', { from: 'Owner', kind: 'person', text: 'after revoke' }), true);
  const out = lines(seat).pop();
  assert.strictEqual(out.epoch, 1);
  assert.strictEqual(fedseal.open({ 0: st.keys[0] }, 'room-rot', out), null, 'the revoked member read a post after the revoke');
  const n = lines(seat).length;
  say(seat, { event: 'connected', room: 'room-rot', expires_at: 10 });
  await settle();
  assert.ok(lines(seat).slice(n).some((f) => f.t === 'key-rotate' && fedseal.openRotate(kb, ownerPub, f, 'room-rot')), 'a reconnect did not re-send the rotate');
});

test('#3728: an edge the coordinator does not list is not taken as revoked', async () => {
  const inv = newInvite('x');
  const { h, seat } = await ownerRoom('proj-rot2', 'ref-rot2', 'room-rot2', [inv]);
  say(seat, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, fedseal.newKeyPair(), 'room-rot2') });
  await settle();
  assert.ok(Object.keys(fedseal.roomState('proj-rot2').peers).length, 'fixture: pinned');
  h.edges = [];
  assert.strictEqual(await fedseats.rotateForRevoked('proj-rot2', federation.linkFor('proj-rot2'), null), false);
  assert.strictEqual(fedseal.roomState('proj-rot2').epoch, 0, 'a partial answer locked a member out');
});

test('#3728: a hello that arrives while a rotation waits for the coordinator is not lost', async () => {
  const a = newInvite('race-a');
  const b = newInvite('race-b');
  const { h, seat } = await ownerRoom('proj-race', 'ref-race-seal', 'room-race', [a, b]);
  say(seat, { event: 'message', data: fedseal.helloFrame(a.s, a.code, fedseal.newKeyPair(), 'room-race') });
  await settle();
  let release;
  h.gate = new Promise((r) => { release = r; });
  h.edges = [{ id: 'edge-inv-race-a', project_ref: 'ref-race-seal', status: 'revoked', invite_id: 'inv-race-a' }, { id: 'edge-inv-race-b', project_ref: 'ref-race-seal', status: 'active', invite_id: 'inv-race-b' }];
  const rotating = fedseats.rotateForRevoked('proj-race', federation.linkFor('proj-race'), null);
  const kb = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(b.s, b.code, kb, 'room-race') });
  await settle();
  release();
  await rotating;
  await settle();
  assert.ok(Object.prototype.hasOwnProperty.call(fedseal.roomState('proj-race').peers, kb.pub), 'a member pinned during a rotation was lost');
});

test('#3728: a member takes a rotate only from the pinned owner, and the old epoch stops opening after a grace', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-26T09:00:00Z') });
  const s = fedseal.randomSecret();
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-rot-m', { role: 'member', edge_id: 'edge-rm' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-rot-m', { role: 'member', s, code: 'code-rm', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-rot-m');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-rm', expires_at: 9 });
  await settle();
  const me = fedseal.sealingKey();
  say(seat, { event: 'message', data: fedseal.rotateFrame(fedseal.newKeyPair(), me.pub, fedseal.randomSecret(), 1, 'room-rm', Date.now()) });
  await settle();
  assert.strictEqual(fedseal.roomState('proj-rot-m').epoch, 0, 'a rotate from an unpinned key was taken');
  const k1 = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, me.pub, k1, 1, 'room-rm', Date.now()) });
  await settle();
  assert.strictEqual(fedseal.roomState('proj-rot-m').epoch, 1);
  // Inside the grace, a message sealed under the old key still opens (it was in flight).
  say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-rm', { from: 'Owner', kind: 'person', text: 'in flight' }) });
  await settle();
  // After the grace, the old key opens nothing (a revoked member posting under it).
  t.mock.timers.tick(91 * 1000);
  say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-rm', { from: 'Revoked', kind: 'person', text: 'still here' }) });
  say(seat, { event: 'message', data: fedseal.seal(k1, 1, 'room-rm', { from: 'Owner', kind: 'person', text: 'current' }) });
  await settle();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['in flight', 'current'], 'the old epoch opened after the grace');
});

test('#3728: a room with no seal state (before sealing, or an older owner) posts and shows in the clear, as before', async () => {
  federation.recordLink('proj-legacy-clear', { role: 'member', edge_id: 'edge-lc' });
  const h = harness();
  await fedseats.ensure('proj-legacy-clear');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-lc', expires_at: 9 });
  await settle();
  assert.strictEqual(lines(seat).length, 0, 'a room with no seal state said hello');
  assert.strictEqual(fedseats.post('proj-legacy-clear', { from: 'Ana', kind: 'person', text: 'plain' }), true);
  assert.strictEqual(lines(seat).pop().text, 'plain');
  say(seat, { event: 'message', data: { from: 'Owner', kind: 'person', text: 'plain back' } });
  await settle();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['plain back']);
});

test('#3728: an owner re-sends the current key on each pass, so a member offline at a rotation catches up', async () => {
  const a = newInvite('cu-a');
  const b = newInvite('cu-b');
  const { h, seat } = await ownerRoom('proj-catchup', 'ref-catchup', 'room-cu', [a, b]);
  const ka = fedseal.newKeyPair();
  const kb = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(a.s, a.code, ka, 'room-cu') });
  say(seat, { event: 'message', data: fedseal.helloFrame(b.s, b.code, kb, 'room-cu') });
  await settle();
  h.edges = [{ id: 'edge-inv-cu-a', project_ref: 'ref-catchup', status: 'revoked', invite_id: 'inv-cu-a' }, { id: 'edge-inv-cu-b', project_ref: 'ref-catchup', status: 'active', invite_id: 'inv-cu-b' }];
  await fedseats.rotateForRevoked('proj-catchup', federation.linkFor('proj-catchup'), null);
  // B was offline and missed that rotate. The owner's seat stays up (no reconnect); the next pass re-sends it.
  const n = lines(seat).length;
  await fedseats.ensureAll();
  const ownerPub = fedseal.sealingKey().pub;
  assert.ok(lines(seat).slice(n).some((f) => f.t === 'key-rotate' && fedseal.openRotate(kb, ownerPub, f, 'room-cu')), 'the pass did not re-send the current key');
});

test('#3728: an owner with no key yet stays sealed when the link record cannot be read', async () => {
  const inv = newInvite('ul');
  const { h, seat } = await ownerRoom('proj-unread', 'ref-unread', 'room-ul', [inv]);
  const f = path.join(require('./store').ROOT, 'federation.json');
  assert.ok(fs.existsSync(f), 'fixture: the link record is where the store keeps it');
  const good = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, '{damaged');
  try {
    assert.strictEqual(fedseats.post('proj-unread', { from: 'Josh', kind: 'person', text: 'must not leave' }), false);
    say(seat, { event: 'message', data: { from: 'Mallory', kind: 'person', text: 'injected' } });
    await settle();
    assert.ok(!lines(seat).some((l) => l.text === 'must not leave'), 'a post left in the clear');
    assert.strictEqual(h.recorded.length, 0, 'a plaintext row was shown');
  } finally {
    fs.writeFileSync(f, good);
  }
});

test('#3728: a member that joined before the owner sealed is told how to get back in', async () => {
  federation.recordLink('proj-mixed', { role: 'member', edge_id: 'edge-mixed' });
  const h = harness();
  await fedseats.ensure('proj-mixed');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-mixed', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-mixed', { from: 'Owner', kind: 'person', text: 'sealed now' }) });
  await settle();
  assert.strictEqual(h.recorded.length, 0);
  assert.ok(h.notes.some((n) => /sealed this shared room since this computer joined/.test(n.text) && /new code/.test(n.text)), JSON.stringify(h.notes));
});

test('#3728: a member catching up on a rotation late does not reopen the old key: the grace runs from the owner\'s rotation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-26T12:00:00Z') });
  const s = fedseal.randomSecret();
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-late', { role: 'member', edge_id: 'edge-late' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-late', { role: 'member', s, code: 'code-late', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-late');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-late', expires_at: 9 });
  await settle();
  // The owner rotated two days ago (a revoke); this member was asleep and catches up now.
  const k1 = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, k1, 1, 'room-late', Date.now() - 2 * 24 * 3600 * 1000) });
  await settle();
  assert.strictEqual(fedseal.roomState('proj-late').epoch, 1, 'fixture: the late rotate was taken');
  // The revoked member posts under the old key the moment this member catches up: not shown.
  say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-late', { from: 'Revoked', kind: 'person', text: 'reopened' }) });
  say(seat, { event: 'message', data: fedseal.seal(k1, 1, 'room-late', { from: 'Owner', kind: 'person', text: 'current' }) });
  await settle();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['current'], 'a late catch-up reopened the old epoch');
});

test('#3728: a member that sees a newer epoch than its own holds its posts until the new key arrives', async () => {
  const s0 = fedseal.randomSecret();
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-behind', { role: 'member', edge_id: 'edge-behind' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-behind', { role: 'member', s: s0, code: 'code-b', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-behind');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-behind', expires_at: 9 });
  await settle();
  // CONTROL: before any sign of a newer epoch, posts go out (sealed under epoch 0).
  assert.strictEqual(fedseats.post('proj-behind', { from: 'Ana', kind: 'person', text: 'before' }), true);
  const k1 = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.seal(k1, 1, 'room-behind', { from: 'Owner', kind: 'person', text: 'new epoch' }) });
  await settle();
  assert.ok(h.notes.some((n) => /behind on this shared room's key/.test(n.text)), JSON.stringify(h.notes));
  const n = lines(seat).length;
  assert.strictEqual(fedseats.post('proj-behind', { from: 'Ana', kind: 'person', text: 'on the old key' }), false, 'a post went out under a key a revoked member may hold');
  assert.strictEqual(lines(seat).length, n);
  // The owner's re-send arrives: posts go out again, under the new epoch.
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, k1, 1, 'room-behind', Date.now()) });
  await settle();
  assert.strictEqual(fedseats.post('proj-behind', { from: 'Ana', kind: 'person', text: 'caught up' }), true);
  assert.strictEqual(lines(seat).pop().epoch, 1);
});

test('#3728: forged newer epochs pause a member at most once per epoch it holds, for at most 3 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-26T13:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-forge-e', { role: 'member', edge_id: 'edge-fe' });
  fedseal.setRoomState('proj-forge-e', { role: 'member', s: fedseal.randomSecret(), code: 'code-fe', peer: owner.pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('proj-forge-e');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-fe', expires_at: 9 });
  await settle();
  const junk = (epoch) => ({ event: 'message', data: { v: 1, epoch, nonce: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAA' } });
  // A garbage envelope claiming a far epoch: held, but only for the bounded pause.
  say(seat, junk(2 ** 53 - 1));
  await settle();
  assert.strictEqual(fedseats.post('proj-forge-e', { from: 'Ana', kind: 'person', text: 'held' }), false);
  t.mock.timers.tick(3 * 60 * 1000 + 1);
  assert.strictEqual(fedseats.post('proj-forge-e', { from: 'Ana', kind: 'person', text: 'back' }), true, 'a forged epoch held posts past the bound');
  // More forged envelopes, any epochs, and a renewal's `connected`: no second pause at this own epoch.
  say(seat, junk(1));
  say(seat, junk(7));
  say(seat, { event: 'connected', room: 'room-fe', expires_at: 10 });
  say(seat, junk(2));
  await settle();
  assert.strictEqual(fedseats.post('proj-forge-e', { from: 'Ana', kind: 'person', text: 'still posting' }), true, 'forged envelopes re-armed the pause');
});

test('#3728: a member two rotations behind holds its posts too', async () => {
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-two-behind', { role: 'member', edge_id: 'edge-tb' });
  fedseal.setRoomState('proj-two-behind', { role: 'member', s: fedseal.randomSecret(), code: 'code-tb', peer: owner.pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('proj-two-behind');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-tb', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 2, 'room-tb', { from: 'Owner', kind: 'person', text: 'epoch two' }) });
  await settle();
  assert.strictEqual(fedseats.post('proj-two-behind', { from: 'Ana', kind: 'person', text: 'on the old key' }), false, 'a member two rotations behind kept posting on the old key');
});

// ---- #5191: an owner refuses a revoked member's posts within seconds ----

/** An owner room with `n` pinned members (invites tagged tag-0, tag-1...), seat connected. */
async function pinnedRoom(id, tag, n, link = {}) {
  const invs = Array.from({ length: n }, (_, i) => newInvite(tag + '-' + i));
  const ref = 'ref-' + tag;
  const room = 'room-' + tag;
  const { h, seat } = await ownerRoom(id, ref, room, invs);
  if (Object.keys(link).length) federation.recordLink(id, Object.assign({ role: 'owner', ref }, link));
  for (const inv of invs) say(seat, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, fedseal.newKeyPair(), room) });
  await settle();
  assert.strictEqual(Object.keys(fedseal.roomState(id).peers).length, n, 'fixture: members pinned');
  const revoke = (i) => { h.edges = invs.map((inv, j) => ({ id: 'edge-' + inv.invite, project_ref: ref, status: j === i ? 'revoked' : 'active', invite_id: inv.invite })); };
  const post = (text, epoch = 0, at = Date.now()) => say(seat, { event: 'message', data: fedseal.seal(fedseal.roomState(id).keys[epoch], epoch, room, { from: 'Guest', kind: 'person', text }, at) });
  return { h, seat, ref, room, revoke, post };
}
const shown = (h) => h.recorded.map((r) => r.text);

test('#5191: revoking the only member: its old-key post is refused at once, and a post before the revoke shows', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-one', 'r1', 1);
  post('before the revoke');
  await settle();
  assert.deepStrictEqual(shown(h), ['before the revoke']);
  // The card's control: the coordinator has the revoke, the owner's 60 s pass has not
  // run, and the member posts 10 s later. The post waits for an edge check (the last
  // one, for the post above, is older than EDGE_FRESH_MS), the check finds the revoke,
  // and with nobody left the old key opens nothing.
  t.mock.timers.tick(20 * 1000);
  revoke(0);
  t.mock.timers.tick(10 * 1000);
  post('10 s after the revoke');
  await settle();
  assert.deepStrictEqual(shown(h), ['before the revoke'], 'a revoked member\'s post was shown');
  const st = fedseal.roomState('proj-5191-one');
  assert.strictEqual(st.epoch, 1, 'the post\'s edge check did not rotate the room');
  assert.deepStrictEqual(st.peers, {});
});

test('#5191: with a member left, the old key opens for 90 s after a revoke (in flight), then never', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-two', 'r2', 2);
  revoke(0);
  assert.strictEqual(await fedseats.rotateForRevoked('proj-5191-two', federation.linkFor('proj-5191-two'), null), true);
  const rotatedAt = fedseal.roomState('proj-5191-two').rotatedAt;
  // Sealed 1 s BEFORE the rotation, arriving just after it: shown (clock rounding).
  t.mock.timers.tick(1000);
  post('sealed 1 s before', 0, rotatedAt - 1000);
  await settle();
  t.mock.timers.tick(60 * 1000);
  post('inside the grace');
  await settle();
  t.mock.timers.tick(30 * 1000);   // 91 s after the rotation
  post('after the grace');
  post('current key', 1);
  await settle();
  assert.deepStrictEqual(shown(h), ['sealed 1 s before', 'inside the grace', 'current key'], 'the old epoch opened past the owner\'s 90 s grace');
});

test('#5191: a restarted owner board keeps the short grace: it reads it from the rooms file', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { revoke } = await pinnedRoom('proj-5191-restart', 'rr', 2);
  revoke(0);
  assert.strictEqual(await fedseats.rotateForRevoked('proj-5191-restart', federation.linkFor('proj-5191-restart'), null), true);
  // A restarted board: a fresh seat manager reading the rooms file.
  const h = harness({ edges: [{ id: 'edge-inv-rr-0', project_ref: 'ref-rr', status: 'revoked', invite_id: 'inv-rr-0' }, { id: 'edge-inv-rr-1', project_ref: 'ref-rr', status: 'active', invite_id: 'inv-rr-1' }] });
  await fedseats.ensure('proj-5191-restart');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-rr', expires_at: 9 });
  await settle();
  const old = (text) => say(seat, { event: 'message', data: fedseal.seal(fedseal.roomState('proj-5191-restart').keys[0], 0, 'room-rr', { from: 'Guest', kind: 'person', text }) });
  t.mock.timers.tick(30 * 1000);
  old('inside the grace');
  await settle();
  t.mock.timers.tick(61 * 1000);   // 91 s after the rotation: past the 90 s grace
  old('after the grace');
  await settle();
  assert.deepStrictEqual(shown(h), ['inside the grace'], 'a restart gave the owner the long grace');
});

test('#5191: an edge check that fails holds the post, and a later check shows it exactly once', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, post } = await pinnedRoom('proj-5191-fail', 'rf', 1);
  h.gate = Promise.reject(new Error('Kosmos+ is unreachable'));
  h.gate.catch(() => {});
  post('during an outage');
  await settle();
  assert.deepStrictEqual(shown(h), [], 'a post was shown before any edge check');
  h.gate = null;
  await fedseats.ensureAll();   // the 60 s pass: its check succeeds
  await settle();
  await fedseats.ensureAll();
  await settle();
  assert.deepStrictEqual(shown(h), ['during an outage'], 'the held post was lost or shown twice');
});

test('#5191: a check still failing at the 60 s pass shows the held post unchecked (today\'s behaviour, never worse)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, post } = await pinnedRoom('proj-5191-down', 'rd', 1);
  h.edges = null;   // Kosmos+ answers, but not with edges
  post('while Kosmos+ is down');
  await settle();
  assert.deepStrictEqual(shown(h), []);
  await fedseats.ensureAll();
  await settle();
  assert.deepStrictEqual(shown(h), ['while Kosmos+ is down']);
});

test('#5191: fifty posts in a second make one edge check, and a fresh check holds nothing', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, post } = await pinnedRoom('proj-5191-flood', 'rfl', 1);
  let release;
  h.gate = new Promise((r) => { release = r; });
  const asked = h.asked;
  for (let i = 0; i < 50; i++) post('post ' + i);
  await settle();
  // A slow coordinator: a post after EDGE_FRESH_MS joins the check still out, not a second one.
  t.mock.timers.tick(16 * 1000);
  post('post 50');
  await settle();
  release();
  h.gate = null;
  await settle();
  assert.strictEqual(h.asked - asked, 1, 'a flood made more than one edge check');
  assert.strictEqual(h.recorded.length, 51);
  // That answer was asked for 16 s ago, so the next post asks again; one right after it does not.
  post('right after');
  await settle();
  assert.strictEqual(h.asked - asked, 2);
  post('and again');
  await settle();
  assert.strictEqual(h.asked - asked, 2, 'a post inside EDGE_FRESH_MS asked again');
  assert.deepStrictEqual(shown(h).slice(-2), ['right after', 'and again']);
});

test('#5191: an owner shared with its own computers still counts only member peers: revoking the only guest refuses its old key', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-self', 'rs', 1, { selfShared: true });
  revoke(0);
  t.mock.timers.tick(5000);
  post('guest after the revoke');
  await settle();
  assert.deepStrictEqual(shown(h), []);
  assert.deepStrictEqual(fedseal.roomState('proj-5191-self').peers, {});
});

test('#5191: a post that cannot open takes no held place, so junk cannot crowd out a member\'s post', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, room, post } = await pinnedRoom('proj-5191-junk', 'rj', 1);
  let release;
  h.gate = new Promise((r) => { release = r; });
  for (let i = 0; i < 70; i++) say(h.spawned[0], { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, room, { from: 'Junk', kind: 'person', text: 'junk ' + i }) });
  post('the member');
  await settle();
  release();
  h.gate = null;
  await settle();
  assert.deepStrictEqual(shown(h), ['the member']);
  assert.ok(!h.notes.some((n) => /more messages than Kosmos keeps in a minute/.test(n.text)), 'junk filled the held places: ' + JSON.stringify(h.notes));
});

test('#5191: past the held cap a post is refused with the minute note, and the held ones still show', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, post } = await pinnedRoom('proj-5191-cap', 'rc', 1);
  let release;
  h.gate = new Promise((r) => { release = r; });
  for (let i = 0; i < fedseats.INBOUND_PER_WINDOW + 1; i++) post('p' + i);
  await settle();
  release();
  h.gate = null;
  await settle();
  assert.strictEqual(h.recorded.length, fedseats.INBOUND_PER_WINDOW);
  assert.strictEqual(h.notes.filter((n) => /more messages than Kosmos keeps in a minute/.test(n.text)).length, 1);
});

test('#5191: busy owner rooms share one edges request per 15 s', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const a = await pinnedRoom('proj-5191-ma', 'rma', 1);
  // A second room on the same harness: its link, invite and pin, without a new harness.
  const inv = newInvite('rmb-0');
  fedseal.stashInvite('ref-rmb', inv);
  federation.recordLink('proj-5191-mb', { role: 'owner', ref: 'ref-rmb' });
  a.h.edges = a.h.edges.concat([{ id: 'edge-' + inv.invite, project_ref: 'ref-rmb', status: 'active', invite_id: inv.invite }]);
  await fedseats.ensure('proj-5191-mb');
  const seatB = a.h.spawned[a.h.spawned.length - 1];
  say(seatB, { event: 'connected', room: 'room-rmb', expires_at: 9 });
  await settle();
  say(seatB, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, fedseal.newKeyPair(), 'room-rmb') });
  await settle();
  t.mock.timers.tick(20 * 1000);
  const asked = a.h.asked;
  a.post('in room A');
  say(seatB, { event: 'message', data: fedseal.seal(fedseal.roomState('proj-5191-mb').keys[0], 0, 'room-rmb', { from: 'Guest', kind: 'person', text: 'in room B' }) });
  await settle();
  assert.strictEqual(a.h.asked - asked, 1, 'two rooms made two edges requests');
  assert.deepStrictEqual(a.h.recorded.map((r) => r.text).slice(-2).sort(), ['in room A', 'in room B']);
});

test('#5191: a room counts as checked from when the answer was asked for, not when it arrived', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, post } = await pinnedRoom('proj-5191-age', 'ra', 1);
  let release;
  h.gate = new Promise((r) => { release = r; });
  const asked = h.asked;
  post('first');
  await settle();
  t.mock.timers.tick(10 * 1000);   // a slow answer
  release();
  h.gate = null;
  await settle();
  t.mock.timers.tick(6 * 1000);    // 16 s after the ask, 6 s after the answer
  post('second');
  await settle();
  assert.strictEqual(h.asked - asked, 2, 'a 16 s old answer was taken as fresh');
  assert.deepStrictEqual(shown(h), ['first', 'second']);
});

test('#5191: an owner refusing an older epoch\'s post re-sends the current key at once, at most once per 15 s', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, seat, revoke, post } = await pinnedRoom('proj-5191-resend', 'rre', 2);
  revoke(0);
  assert.strictEqual(await fedseats.rotateForRevoked('proj-5191-resend', federation.linkFor('proj-5191-resend'), null), true);
  t.mock.timers.tick(120 * 1000);   // past the grace: the remaining member missed the rotation
  await fedseats.ensureAll();        // a fresh check, so the posts below are not held
  await settle();
  const before = lines(seat).filter((f) => f.t === 'key-rotate').length;
  post('behind 1');
  post('behind 2');
  await settle();
  assert.strictEqual(lines(seat).filter((f) => f.t === 'key-rotate').length, before + 1, 'the key was not re-sent once');
  assert.deepStrictEqual(shown(h), []);
  t.mock.timers.tick(16 * 1000);
  post('behind 3');
  await settle();
  assert.strictEqual(lines(seat).filter((f) => f.t === 'key-rotate').length, before + 2, 'the re-send never came back after 15 s');
});

test('#5191: a clock stepped back does not switch the hold off', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-clock', 'rcl', 1);
  post('checked now');
  await settle();
  t.mock.timers.setTime(Date.parse('2026-10-03T19:00:00Z'));   // an hour back
  revoke(0);
  post('after the revoke');
  await settle();
  assert.deepStrictEqual(shown(h), ['checked now'], 'a check stamped in the future counted as fresh');
});

test('#5191: the held-cap note is said once a day, not once per check', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, post } = await pinnedRoom('proj-5191-capday', 'rcd', 1);
  for (let round = 0; round < 2; round++) {
    let release;
    h.gate = new Promise((r) => { release = r; });
    for (let i = 0; i <= fedseats.INBOUND_PER_WINDOW; i++) post('r' + round + 'p' + i);
    await settle();
    release();
    h.gate = null;
    await settle();
    t.mock.timers.tick(61 * 1000);   // past the minute and the check
  }
  assert.strictEqual(h.notes.filter((n) => /more messages than Kosmos keeps in a minute/.test(n.text)).length, 1);
});

test('#5191: a replayed held post takes no second place, and the exported onEvent cannot skip the hold', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, room } = await pinnedRoom('proj-5191-replay', 'rrp', 1);
  let release;
  h.gate = new Promise((r) => { release = r; });
  const line = JSON.stringify({ event: 'message', data: fedseal.seal(fedseal.roomState('proj-5191-replay').keys[0], 0, room, { from: 'Guest', kind: 'person', text: 'once' }) });
  for (let i = 0; i < fedseats.INBOUND_PER_WINDOW + 5; i++) fedseats.onEvent('proj-5191-replay', line, true);
  await settle();
  assert.deepStrictEqual(shown(h), [], 'a third argument skipped the hold');
  release();
  h.gate = null;
  await settle();
  assert.deepStrictEqual(shown(h), ['once']);
  assert.ok(!h.notes.some((n) => /more messages than Kosmos keeps in a minute/.test(n.text)), 'replays filled the held places');
});

test('#5191: a member pinned after the only one was revoked does not reopen the revoked key', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const inv0 = newInvite('rnm-0');
  const inv1 = newInvite('rnm-1');
  const { h, seat } = await ownerRoom('proj-5191-newmember', 'ref-rnm', 'room-rnm', [inv0, inv1]);
  say(seat, { event: 'message', data: fedseal.helloFrame(inv0.s, inv0.code, fedseal.newKeyPair(), 'room-rnm') });
  await settle();
  const oldKey = fedseal.roomState('proj-5191-newmember').keys[0];
  h.edges = [{ id: 'edge-inv-rnm-0', project_ref: 'ref-rnm', status: 'revoked', invite_id: 'inv-rnm-0' }, { id: 'edge-inv-rnm-1', project_ref: 'ref-rnm', status: 'active', invite_id: 'inv-rnm-1' }];
  assert.strictEqual(await fedseats.rotateForRevoked('proj-5191-newmember', federation.linkFor('proj-5191-newmember'), null), true);
  t.mock.timers.tick(5000);
  say(seat, { event: 'message', data: fedseal.helloFrame(inv1.s, inv1.code, fedseal.newKeyPair(), 'room-rnm') });
  await settle();
  assert.strictEqual(Object.keys(fedseal.roomState('proj-5191-newmember').peers).length, 1, 'fixture: the new member is pinned');
  t.mock.timers.tick(5000);
  say(seat, { event: 'message', data: fedseal.seal(oldKey, 0, 'room-rnm', { from: 'Revoked', kind: 'person', text: 'old key after a new member' }) });
  await settle();
  assert.deepStrictEqual(shown(h), [], 'a new member reopened the revoked member\'s key');
});

test('#5191: re-shaped copies and stale posts take no held place, so they cannot crowd out an honest post', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, room, post } = await pinnedRoom('proj-5191-pad', 'rpd', 1);
  const key = fedseal.roomState('proj-5191-pad').keys[0];
  let release;
  h.gate = new Promise((r) => { release = r; });
  const env = fedseal.seal(key, 0, room, { from: 'Guest', kind: 'person', text: 'once' });
  for (let i = 0; i < fedseats.INBOUND_PER_WINDOW + 5; i++) say(h.spawned[0], { event: 'message', data: Object.assign({ pad: i }, env) });
  for (let i = 0; i < fedseats.INBOUND_PER_WINDOW + 5; i++) post('stale ' + i, 0, Date.now() - 2 * 3600 * 1000);
  post('honest');
  await settle();
  release();
  h.gate = null;
  await settle();
  assert.deepStrictEqual(shown(h), ['once', 'honest']);
  assert.ok(!h.notes.some((n) => /more messages than Kosmos keeps in a minute/.test(n.text)), JSON.stringify(h.notes));
});

test('#5191: a replay of a post already shown is refused at once and asks Kosmos+ nothing', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, room } = await pinnedRoom('proj-5191-seen', 'rsn', 1);
  const env = fedseal.seal(fedseal.roomState('proj-5191-seen').keys[0], 0, room, { from: 'Guest', kind: 'person', text: 'shown once' });
  say(h.spawned[0], { event: 'message', data: env });
  await settle();
  t.mock.timers.tick(20 * 1000);
  const asked = h.asked;
  say(h.spawned[0], { event: 'message', data: env });
  await settle();
  assert.strictEqual(h.asked, asked, 'a replay of a shown post triggered an edges request');
  assert.deepStrictEqual(shown(h), ['shown once']);
});

test('#5191: a room that joined another room\'s answer asks again once that answer is 15 s old', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const a = await pinnedRoom('proj-5191-ja', 'rja', 1);
  const inv = newInvite('rjb-0');
  fedseal.stashInvite('ref-rjb', inv);
  federation.recordLink('proj-5191-jb', { role: 'owner', ref: 'ref-rjb' });
  a.h.edges = a.h.edges.concat([{ id: 'edge-' + inv.invite, project_ref: 'ref-rjb', status: 'active', invite_id: inv.invite }]);
  await fedseats.ensure('proj-5191-jb');
  const seatB = a.h.spawned[a.h.spawned.length - 1];
  say(seatB, { event: 'connected', room: 'room-rjb', expires_at: 9 });
  await settle();
  say(seatB, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, fedseal.newKeyPair(), 'room-rjb') });
  await settle();
  const postB = (text) => say(seatB, { event: 'message', data: fedseal.seal(fedseal.roomState('proj-5191-jb').keys[0], 0, 'room-rjb', { from: 'Guest', kind: 'person', text }) });
  t.mock.timers.tick(20 * 1000);
  const asked = a.h.asked;
  a.post('A at 0');
  await settle();
  t.mock.timers.tick(14 * 1000);
  postB('B at 14');          // joins A's answer, asked at 0
  await settle();
  assert.strictEqual(a.h.asked - asked, 1);
  t.mock.timers.tick(2 * 1000);
  postB('B at 16');          // that answer is 16 s old: B must ask again, not wait for the pass
  await settle();
  assert.strictEqual(a.h.asked - asked, 2, 'B waited on its own ask time instead of the answer\'s');
  assert.deepStrictEqual(a.h.recorded.map((r) => r.text).slice(-3), ['A at 0', 'B at 14', 'B at 16']);
});

test('#5191: a check that cannot read the rooms record is not counted as a check', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-eio', 'reio', 1);
  t.mock.timers.tick(20 * 1000);
  revoke(0);
  let release;
  h.gate = new Promise((r) => { release = r; });
  post('held');
  await settle();
  // The record cannot be read while the answer comes back.
  const real = fedseal.roomState;
  const broken = t.mock.method(fedseal, 'roomState', () => { throw new Error('EIO'); });
  release();
  h.gate = null;
  await settle();
  broken.mock.restore();
  assert.strictEqual(fedseal.roomState, real);
  t.mock.timers.tick(2000);
  post('2 s later');
  await settle();
  await fedseats.ensureAll();
  await settle();
  assert.deepStrictEqual(shown(h), [], 'an unreadable record counted as a check and let the revoked key through');
  assert.strictEqual(fedseal.roomState('proj-5191-eio').epoch, 1);
});

test('#5191: a held post keeps the grace it arrived in, even when its check fails until the pass', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-graceheld', 'rgh', 2);
  revoke(0);
  await fedseats.ensureAll();   // the pass rotates at R
  await settle();
  assert.strictEqual(fedseal.roomState('proj-5191-graceheld').epoch, 1, 'fixture: rotated');
  t.mock.timers.tick(40 * 1000);
  h.edges = null;                // Kosmos+ cannot answer
  post('sealed before the remaining member caught up');   // old key, R+40: inside the 90 s grace
  await settle();
  assert.deepStrictEqual(shown(h), []);
  t.mock.timers.tick(60 * 1000); // the next pass, R+100, its check failing too
  await fedseats.ensureAll();
  await settle();
  assert.deepStrictEqual(shown(h), ['sealed before the remaining member caught up'], 'the hold ran out the post\'s grace');
});

test('#5191: a clock stepped back does not reopen the previous key', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-backgrace', 'rbg', 2);
  revoke(0);
  assert.strictEqual(await fedseats.rotateForRevoked('proj-5191-backgrace', federation.linkFor('proj-5191-backgrace'), null), true);
  t.mock.timers.setTime(Date.parse('2026-10-03T19:00:00Z'));   // an hour back
  await fedseats.ensureAll();
  await settle();
  post('old key, clock back');
  await settle();
  assert.deepStrictEqual(shown(h), []);
});

test('#5191: a pass that cannot read the rooms record does not count the room as checked', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-eiopass', 'reip', 1);
  t.mock.timers.tick(20 * 1000);
  const broken = t.mock.method(fedseal, 'roomState', () => { throw new Error('EIO'); });
  await fedseats.ensureAll();
  await settle();
  broken.mock.restore();
  revoke(0);
  t.mock.timers.tick(2000);
  post('2 s after an unreadable pass');
  await settle();
  assert.deepStrictEqual(shown(h), [], 'an unreadable pass counted as a check');
});

test('#5191: while the owner\'s link cannot be read a post is held, not shown, and the first readable pass checks it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-nolink', 'rnl', 1);
  t.mock.timers.tick(20 * 1000);
  revoke(0);
  const asked = h.asked;
  const broken = t.mock.method(federation, 'linkFor', () => { throw new Error('EIO'); });
  post('from the revoked member while the link is unreadable');
  await settle();
  assert.deepStrictEqual(shown(h), [], 'an unreadable link record let a post through unchecked');
  assert.strictEqual(h.asked, asked, 'a check started without the link');
  broken.mock.restore();
  await fedseats.ensureAll();
  await settle();
  assert.deepStrictEqual(shown(h), [], 'the revoked member\'s held post was shown');
  assert.strictEqual(fedseal.roomState('proj-5191-nolink').epoch, 1);
  assert.ok(h.notes.some((n) => /earlier key arrived after that key was retired/.test(n.text)), JSON.stringify(h.notes));
});

test('#5191: a pass that cannot read the rooms record keeps held posts for the next pass instead of refusing them', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, post } = await pinnedRoom('proj-5191-passeio', 'rpe', 1);
  t.mock.timers.tick(20 * 1000);
  h.edges = null;
  post('held through an unreadable pass');
  await settle();
  const broken = t.mock.method(fedseal, 'roomState', () => { throw new Error('EIO'); });
  await fedseats.ensureAll();
  await settle();
  broken.mock.restore();
  assert.deepStrictEqual(shown(h), []);
  await fedseats.ensureAll();
  await settle();
  assert.deepStrictEqual(shown(h), ['held through an unreadable pass']);
});

test('#5191: a remaining member\'s post held while its own check rotates the room is still shown', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5191-inflight', 'rif', 2);
  t.mock.timers.tick(20 * 1000);
  revoke(0);
  let release;
  h.gate = new Promise((r) => { release = r; });
  post('in flight from the member who stays');   // old key, held; its check finds the revoke
  await settle();
  t.mock.timers.tick(3000);
  release();
  h.gate = null;
  await settle();
  assert.strictEqual(fedseal.roomState('proj-5191-inflight').epoch, 1, 'fixture: the check rotated');
  assert.deepStrictEqual(shown(h), ['in flight from the member who stays']);
});

test('#5191: during an outage busy owner rooms still share one edges request per 15 s', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const a = await pinnedRoom('proj-5191-oa', 'roa', 1);
  const inv = newInvite('rob-0');
  fedseal.stashInvite('ref-rob', inv);
  federation.recordLink('proj-5191-ob', { role: 'owner', ref: 'ref-rob' });
  a.h.edges = a.h.edges.concat([{ id: 'edge-' + inv.invite, project_ref: 'ref-rob', status: 'active', invite_id: inv.invite }]);
  await fedseats.ensure('proj-5191-ob');
  const seatB = a.h.spawned[a.h.spawned.length - 1];
  say(seatB, { event: 'connected', room: 'room-rob', expires_at: 9 });
  await settle();
  say(seatB, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, fedseal.newKeyPair(), 'room-rob') });
  await settle();
  t.mock.timers.tick(20 * 1000);
  a.h.edges = null;   // Kosmos+ answers {ok: false}
  const asked = a.h.asked;
  a.post('A during the outage');
  await settle();
  say(seatB, { event: 'message', data: fedseal.seal(fedseal.roomState('proj-5191-ob').keys[0], 0, 'room-rob', { from: 'Guest', kind: 'person', text: 'B during the outage' }) });
  await settle();
  assert.strictEqual(a.h.asked - asked, 1, 'a failed answer made every room ask on its own');
});

test('#5191: a forged post claiming the previous epoch inside its grace is not called a retired key', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T20:00:00Z') });
  const { h, seat, room, revoke } = await pinnedRoom('proj-5191-forged', 'rfg', 2);
  revoke(0);
  assert.strictEqual(await fedseats.rotateForRevoked('proj-5191-forged', federation.linkFor('proj-5191-forged'), null), true);
  await fedseats.ensureAll();
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, room, { from: 'Forger', kind: 'person', text: 'x' }) });
  await settle();
  assert.ok(!h.notes.some((n) => /was retired/.test(n.text)), JSON.stringify(h.notes));
  assert.ok(h.notes.some((n) => /could not open/.test(n.text)));
});

test('#5197: a remaining member opens a revoked member\'s old key for 90 s after the rotation, not 10 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T21:00:00Z') });
  const s = fedseal.randomSecret();
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-m', { role: 'member', edge_id: 'edge-5197' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-5197-m', { role: 'member', s, code: 'code-5197', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-5197-m');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197', expires_at: 9 });
  await settle();
  const k1 = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, k1, 1, 'room-5197', Date.now()) });
  await settle();
  assert.strictEqual(fedseal.roomState('proj-5197-m').epoch, 1, 'fixture: rotated');
  t.mock.timers.tick(89 * 1000);
  say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-5197', { from: 'In flight', kind: 'person', text: 'at 89 s' }) });
  await settle();
  t.mock.timers.tick(2 * 1000);    // 91 s after the rotation: the revoked member is still posting
  say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-5197', { from: 'Revoked', kind: 'person', text: 'at 91 s' }) });
  await settle();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['at 89 s'], 'a member opened the old key past 90 s');
  assert.ok(h.notes.some((n) => /earlier key arrived after that key was retired/.test(n.text)), 'refused for some other reason: ' + JSON.stringify(h.notes));
  assert.ok(h.notes.some((n) => /clock may be off/.test(n.text)), 'a member\'s note does not name its clock: ' + JSON.stringify(h.notes));
});

test('#5197: a member that joined after a rotation is not told a key was retired for an epoch it never held', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T21:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-late', { role: 'member', edge_id: 'edge-5197-late' });
  const k2 = fedseal.randomSecret();
  fedseal.setRoomState('proj-5197-late', { role: 'member', s: fedseal.randomSecret(), code: 'code-late', peer: owner.pub, epoch: 2, keys: { 2: k2 } });
  const h = harness();
  await fedseats.ensure('proj-5197-late');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-late', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 1, 'room-5197-late', { from: 'Lagging', kind: 'person', text: 'epoch 1' }) });
  await settle();
  assert.ok(!h.notes.some((n) => /was retired/.test(n.text)), JSON.stringify(h.notes));
  assert.ok(h.notes.some((n) => /could not open/.test(n.text)));
});

test('#5197: a member\'s grace runs from the owner\'s rotation time, clamped to its own clock', async (t) => {
  for (const [label, skew, at, shows] of [
    ['member clock 2 min ahead of the owner: fails closed', -120 * 1000, 1000, false],
    ['member clock 2 min behind the owner: runs from receipt', 120 * 1000, 60 * 1000, true],
  ]) {
    t.mock.timers.reset();
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T21:00:00Z') });
    const id = 'proj-5197-skew-' + (shows ? 'behind' : 'ahead');
    const owner = fedseal.newKeyPair();
    federation.recordLink(id, { role: 'member', edge_id: 'edge-' + id });
    const k0 = fedseal.randomSecret();
    fedseal.setRoomState(id, { role: 'member', s: fedseal.randomSecret(), code: 'code-' + id, peer: owner.pub, epoch: 0, keys: { 0: k0 } });
    const h = harness();
    await fedseats.ensure(id);
    const seat = h.spawned[0];
    say(seat, { event: 'connected', room: 'room-' + id, expires_at: 9 });
    await settle();
    // The owner stamps the rotation on ITS clock: skew from this member's.
    say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, fedseal.randomSecret(), 1, 'room-' + id, Date.now() + skew) });
    await settle();
    assert.strictEqual(fedseal.roomState(id).epoch, 1, 'fixture: rotated');
    t.mock.timers.tick(at);
    say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-' + id, { from: 'In flight', kind: 'person', text: label }) });
    await settle();
    assert.deepStrictEqual(h.recorded.map((r) => r.text), shows ? [label] : [], label);
    if (!shows) assert.ok(h.notes.some((n) => /was retired/.test(n.text)), 'refused for another reason: ' + JSON.stringify(h.notes));
    if (shows) {   // the slow clock's grace still ends 90 s after receipt
      t.mock.timers.tick(31 * 1000);
      say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-' + id, { from: 'Late', kind: 'person', text: '91 s after receipt' }) });
      await settle();
      assert.deepStrictEqual(h.recorded.map((r) => r.text), [label], 'a slow clock kept the old key open past 90 s from receipt');
    }
  }
});

test('#5197: a member opens only the epoch just before its current one (unchanged by #5197, pinned with the shorter grace)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T21:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-two', { role: 'member', edge_id: 'edge-5197-two' });
  const k = [fedseal.randomSecret(), fedseal.randomSecret(), fedseal.randomSecret()];
  fedseal.setRoomState('proj-5197-two', { role: 'member', s: fedseal.randomSecret(), code: 'code-two', peer: owner.pub, epoch: 0, keys: { 0: k[0] } });
  const h = harness();
  await fedseats.ensure('proj-5197-two');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-two', expires_at: 9 });
  await settle();
  const me = fedseal.sealingKey().pub;
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, me, k[1], 1, 'room-5197-two', Date.now()) });
  await settle();
  t.mock.timers.tick(30 * 1000);
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, me, k[2], 2, 'room-5197-two', Date.now()) });
  await settle();
  t.mock.timers.tick(1000);
  const post = (epoch, text) => say(seat, { event: 'message', data: fedseal.seal(k[epoch], epoch, 'room-5197-two', { from: 'X', kind: 'person', text }) });
  post(0, 'epoch 0, two rotations back');
  post(1, 'epoch 1, inside its grace');
  post(2, 'epoch 2, current');
  await settle();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['epoch 1, inside its grace', 'epoch 2, current']);
});

test('#5197: a member that skipped an epoch opens neither older one, and is told only about the one it held', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T21:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-skip', { role: 'member', edge_id: 'edge-5197-skip' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-5197-skip', { role: 'member', s: fedseal.randomSecret(), code: 'code-skip', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-5197-skip');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-skip', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, fedseal.randomSecret(), 2, 'room-5197-skip', Date.now()) });
  await settle();
  assert.strictEqual(fedseal.roomState('proj-5197-skip').epoch, 2, 'fixture: jumped to epoch 2');
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 1, 'room-5197-skip', { from: 'X', kind: 'person', text: 'epoch 1' }) });
  await settle();
  assert.ok(h.notes.some((n) => /could not open/.test(n.text)) && !h.notes.some((n) => /was retired/.test(n.text)), JSON.stringify(h.notes));
  say(seat, { event: 'message', data: fedseal.seal(k0, 0, 'room-5197-skip', { from: 'X', kind: 'person', text: 'epoch 0' }) });
  await settle();
  assert.deepStrictEqual(h.recorded, []);
  assert.ok(h.notes.some((n) => /was retired/.test(n.text)), JSON.stringify(h.notes));
});

test('#5197: the retired note names this computer\'s clock only on a member\'s board', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T22:00:00Z') });
  const { h, revoke, post } = await pinnedRoom('proj-5197-ownernote', 'ron', 2);
  revoke(0);
  assert.strictEqual(await fedseats.rotateForRevoked('proj-5197-ownernote', federation.linkFor('proj-5197-ownernote'), null), true);
  t.mock.timers.tick(120 * 1000);
  await fedseats.ensureAll();
  await settle();
  post('old key, 2 minutes after the rotation');
  await settle();
  const note = h.notes.find((n) => /was retired/.test(n.text));
  assert.ok(note, JSON.stringify(h.notes));
  assert.ok(!/clock/.test(note.text), 'the owner was told to suspect its own clock: ' + note.text);
});

test('#5197: a member still behind after its hold is told a post may not be shown', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T22:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-behind', { role: 'member', edge_id: 'edge-5197-behind' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-5197-behind', { role: 'member', s: fedseal.randomSecret(), code: 'code-behind', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-5197-behind');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-behind', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 1, 'room-5197-behind', { from: 'A', kind: 'person', text: 'epoch 1' }) });
  await settle();
  assert.strictEqual(fedseats.post('proj-5197-behind', { from: 'B', kind: 'person', text: 'held' }), false);
  t.mock.timers.tick(3 * 60 * 1000 + 1000);
  assert.strictEqual(fedseats.post('proj-5197-behind', { from: 'B', kind: 'person', text: 'after the hold' }), true);
  assert.ok(h.notes.some((n) => /may be behind on this shared room.s key, so a message sent now may not be shown/.test(n.text)), JSON.stringify(h.notes));
});

test('#5197: a forged higher epoch holds a member for at most the 3 minute hold, even after a real rotation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T22:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-forged', { role: 'member', edge_id: 'edge-5197-forged' });
  fedseal.setRoomState('proj-5197-forged', { role: 'member', s: fedseal.randomSecret(), code: 'code-forged', peer: owner.pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('proj-5197-forged');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-forged', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 999, 'room-5197-forged', { from: 'Forger', kind: 'person', text: 'x' }) });
  await settle();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, fedseal.randomSecret(), 1, 'room-5197-forged', Date.now()) });
  await settle();
  // A rotation short of the claimed epoch cannot tell a forgery from a real lag: it keeps
  // holding, and the hold's own bound is what limits a forger.
  assert.strictEqual(fedseats.post('proj-5197-forged', { from: 'B', kind: 'person', text: 'caught up' }), false);
  t.mock.timers.tick(3 * 60 * 1000 + 1000);
  assert.strictEqual(fedseats.post('proj-5197-forged', { from: 'B', kind: 'person', text: 'later' }), true, 'a forged epoch held a member past 3 minutes');
});

test('#5197: a rotation that does not reach the epoch that armed the hold does not end it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T22:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-partial', { role: 'member', edge_id: 'edge-5197-partial' });
  fedseal.setRoomState('proj-5197-partial', { role: 'member', s: fedseal.randomSecret(), code: 'code-partial', peer: owner.pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('proj-5197-partial');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-partial', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 2, 'room-5197-partial', { from: 'A', kind: 'person', text: 'epoch 2' }) });
  await settle();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, fedseal.randomSecret(), 1, 'room-5197-partial', Date.now()) });
  await settle();
  assert.strictEqual(fedseal.roomState('proj-5197-partial').epoch, 1, 'fixture: moved to epoch 1');
  assert.strictEqual(fedseats.post('proj-5197-partial', { from: 'B', kind: 'person', text: 'still behind epoch 2' }), false, 'a rotation short of epoch 2 ended the hold');
});

test('#5197: a forged epoch that armed a hold does not use up the warning for a real lag later', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T22:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-twice', { role: 'member', edge_id: 'edge-5197-twice' });
  fedseal.setRoomState('proj-5197-twice', { role: 'member', s: fedseal.randomSecret(), code: 'code-twice', peer: owner.pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('proj-5197-twice');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-twice', expires_at: 9 });
  await settle();
  const warned = () => h.notes.filter((n) => /may be behind on this shared room/.test(n.text)).length;
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 999, 'room-5197-twice', { from: 'Forger', kind: 'person', text: 'x' }) });
  await settle();
  t.mock.timers.tick(3 * 60 * 1000 + 1000);
  fedseats.post('proj-5197-twice', { from: 'B', kind: 'person', text: 'after a forged hold' });
  assert.strictEqual(warned(), 1);
  // A real rotation to 1, then a real one to 2 this member misses.
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, fedseal.randomSecret(), 1, 'room-5197-twice', Date.now()) });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 2, 'room-5197-twice', { from: 'A', kind: 'person', text: 'epoch 2' }) });
  await settle();
  t.mock.timers.tick(3 * 60 * 1000 + 1000);
  fedseats.post('proj-5197-twice', { from: 'B', kind: 'person', text: 'after a real hold' });
  assert.strictEqual(warned(), 2, 'the forged hold used up the warning for the real one');
});

test('#5197: a member that rotated since a forged epoch armed its hold is not warned it may be behind', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T22:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5197-stale', { role: 'member', edge_id: 'edge-5197-stale' });
  fedseal.setRoomState('proj-5197-stale', { role: 'member', s: fedseal.randomSecret(), code: 'code-stale', peer: owner.pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('proj-5197-stale');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5197-stale', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 999, 'room-5197-stale', { from: 'Forger', kind: 'person', text: 'x' }) });
  await settle();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, fedseal.randomSecret(), 1, 'room-5197-stale', Date.now()) });
  await settle();
  t.mock.timers.tick(3 * 60 * 1000 + 1000);
  assert.strictEqual(fedseats.post('proj-5197-stale', { from: 'B', kind: 'person', text: 'current' }), true);
  assert.ok(!h.notes.some((n) => /may be behind on this shared room/.test(n.text)), JSON.stringify(h.notes));
});

// ---- #5192: posts held for the room key are sent when it arrives ----

test('#5192: a member\'s post held before the owner shares the key is sent, sealed, when it arrives', async () => {
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-m', { role: 'member', edge_id: 'edge-5192-m' });
  fedseal.setRoomState('proj-5192-m', { role: 'member', s: sk, code: 'code-5192', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-m');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-m', expires_at: 9 });
  await settle();
  assert.strictEqual(fedseats.post('proj-5192-m', { from: 'Ana', kind: 'person', text: 'first' }), false);
  assert.strictEqual(fedseats.post('proj-5192-m', { from: 'Ana', kind: 'person', text: 'second' }), false);
  assert.ok(h.notes.some((n) => /is held on this computer: .*has not shared its key yet\. It is sent when the key arrives/.test(n.text)), JSON.stringify(h.notes));
  const before = lines(seat).length;
  const owner = fedseal.newKeyPair();
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192', owner, fedseal.sealingKey().pub, roomKey, 0, 'room-5192-m') });
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: roomKey }, 'room-5192-m', f));
  assert.deepStrictEqual(out.map((o) => o && o.m.text), ['first', 'second'], 'the held posts were not sent, sealed, in order');
  assert.ok(h.notes.some((n) => /2 messages held on this computer were sent/.test(n.text)), JSON.stringify(h.notes));
});

test('#5192: an owner\'s post held before any member\'s key is sent once the first member is pinned', async () => {
  const inv = newInvite('5192o');
  const { h, seat } = await ownerRoom('proj-5192-o', 'ref-5192-o', 'room-5192-o', [inv]);
  assert.strictEqual(fedseats.post('proj-5192-o', { from: 'Josh', kind: 'person', text: 'before anyone' }), false);
  const member = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, member, 'room-5192-o') });
  await settle();
  const frames = lines(seat);
  const shareAt = frames.findIndex((f) => f.t === 'key-share');
  assert.ok(shareAt >= 0, 'fixture: no share');
  const got = fedseal.openShare(inv.s, inv.code, member, frames[shareAt], 'room-5192-o');
  const after = frames.slice(shareAt + 1).map((f) => fedseal.open({ [got.epoch]: got.roomKey }, 'room-5192-o', f)).filter(Boolean);
  assert.deepStrictEqual(after.map((o) => o.m.text), ['before anyone'], 'the held post did not follow the key share');
  void h;
});

test('#5192: posts held while a member is behind go out, in order, when the new key arrives, and a later post cannot overtake them', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T23:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5192-b', { role: 'member', edge_id: 'edge-5192-b' });
  fedseal.setRoomState('proj-5192-b', { role: 'member', s: fedseal.randomSecret(), code: 'code-5192b', peer: owner.pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('proj-5192-b');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-b', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 1, 'room-5192-b', { from: 'A', kind: 'person', text: 'epoch 1' }) });
  await settle();
  fedseats.post('proj-5192-b', { from: 'B', kind: 'person', text: 'held 1' });
  fedseats.post('proj-5192-b', { from: 'B', kind: 'person', text: 'held 2' });
  const before = lines(seat).length;
  const k1 = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, fedseal.sealingKey().pub, k1, 1, 'room-5192-b', Date.now()) });
  await settle();
  assert.strictEqual(lines(seat).length - before, 2, 'the held posts did not go out when the new key arrived');
  assert.strictEqual(fedseats.post('proj-5192-b', { from: 'B', kind: 'person', text: 'after' }), true);
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 1: k1 }, 'room-5192-b', f));
  assert.deepStrictEqual(out.map((o) => o && o.m.text), ['held 1', 'held 2', 'after']);
  void h;
});

test('#5192: a post held for more than an hour is not sent, and the room says so; the hold is capped', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T23:00:00Z') });
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-old', { role: 'member', edge_id: 'edge-5192-old' });
  fedseal.setRoomState('proj-5192-old', { role: 'member', s: sk, code: 'code-5192old', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-old');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-old', expires_at: 9 });
  await settle();
  fedseats.post('proj-5192-old', { from: 'Ana', kind: 'person', text: 'old' });
  t.mock.timers.tick(61 * 60 * 1000);
  for (let i = 0; i < 60; i++) fedseats.post('proj-5192-old', { from: 'Ana', kind: 'person', text: 'p' + i });
  assert.ok(h.notes.some((n) => /as many messages as Kosmos sends at once are already waiting/.test(n.text)), 'the hold was not capped');
  const before = lines(seat).length;
  const owner = fedseal.newKeyPair();
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192old', owner, fedseal.sealingKey().pub, roomKey, 0, 'room-5192-old') });
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: roomKey }, 'room-5192-old', f));
  assert.strictEqual(out.length, 50, 'a post held past the hour still took a place');
  assert.ok(!out.some((o) => o.m.text === 'old'), 'a post held for more than an hour was sent');
  assert.ok(h.notes.some((n) => /1 held message was not sent: held for more than an hour/.test(n.text)), JSON.stringify(h.notes));
});

test('#5192: when a behind hold runs out with no new key, a new post sends the held ones first', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T23:00:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5192-exp', { role: 'member', edge_id: 'edge-5192-exp' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-5192-exp', { role: 'member', s: fedseal.randomSecret(), code: 'code-5192exp', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-5192-exp');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-exp', expires_at: 9 });
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 1, 'room-5192-exp', { from: 'A', kind: 'person', text: 'epoch 1' }) });
  await settle();
  fedseats.post('proj-5192-exp', { from: 'B', kind: 'person', text: 'held' });
  const before = lines(seat).length;
  t.mock.timers.tick(3 * 60 * 1000 + 1000);
  assert.strictEqual(fedseats.post('proj-5192-exp', { from: 'B', kind: 'person', text: 'after the hold' }), true);
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: k0 }, 'room-5192-exp', f));
  assert.deepStrictEqual(out.map((o) => o && o.m.text), ['held', 'after the hold'], 'a new post overtook a held one');
  void h;
});

test('#5192: a held post refused for good does not strand the ones behind it', async () => {
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-long', { role: 'member', edge_id: 'edge-5192-long' });
  fedseal.setRoomState('proj-5192-long', { role: 'member', s: sk, code: 'code-5192long', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-long');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-long', expires_at: 9 });
  await settle();
  fedseats.post('proj-5192-long', { from: 'Ana', kind: 'person', text: 'x'.repeat(20 * 1024) });
  fedseats.post('proj-5192-long', { from: 'Ana', kind: 'person', text: 'B' });
  fedseats.post('proj-5192-long', { from: 'Ana', kind: 'person', text: 'C' });
  const before = lines(seat).length;
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192long', fedseal.newKeyPair(), fedseal.sealingKey().pub, roomKey, 0, 'room-5192-long') });
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: roomKey }, 'room-5192-long', f));
  assert.deepStrictEqual(out.map((o) => o && o.m.text), ['B', 'C']);
  assert.ok(h.notes.some((n) => /too long to send/.test(n.text)));
  const toolong = h.notes.findIndex((n) => /too long to send/.test(n.text));
  const firstHeld = h.notes.findIndex((n) => /is held on this computer/.test(n.text));
  assert.ok(toolong < firstHeld, 'a post that could never go was told it would be sent: ' + JSON.stringify(h.notes));
});

test('#5192: a held post that had a file says the file stayed when it is sent', async () => {
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-file', { role: 'member', edge_id: 'edge-5192-file' });
  fedseal.setRoomState('proj-5192-file', { role: 'member', s: sk, code: 'code-5192file', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-file');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-file', expires_at: 9 });
  await settle();
  fedseats.post('proj-5192-file', { from: 'Ana', kind: 'person', text: 'see the attached plan', files: true });
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192file', fedseal.newKeyPair(), fedseal.sealingKey().pub, fedseal.randomSecret(), 0, 'room-5192-file') });
  await settle();
  assert.ok(h.notes.some((n) => /held on this computer was sent\. Its attached file stayed on this computer/.test(n.text)), JSON.stringify(h.notes));
});

test('#5192: a post held for a missing room id goes out when the seat connects with one; the 60 s pass flushes too', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-03T23:30:00Z') });
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5192-room', { role: 'member', edge_id: 'edge-5192-room' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-5192-room', { role: 'member', s: fedseal.randomSecret(), code: 'code-5192room', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-5192-room');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', expires_at: 9 });   // no room id
  await settle();
  assert.strictEqual(fedseats.post('proj-5192-room', { from: 'Ana', kind: 'person', text: 'no room yet' }), false);
  const before = lines(seat).length;
  say(seat, { event: 'connected', room: 'room-5192-room', expires_at: 10 });
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: k0 }, 'room-5192-room', f)).filter(Boolean);
  assert.deepStrictEqual(out.map((o) => o.m.text), ['no room yet']);
  // The pass: a behind hold that ran out with nobody posting since sends its held post.
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 1, 'room-5192-room', { from: 'A', kind: 'person', text: 'epoch 1' }) });
  await settle();
  fedseats.post('proj-5192-room', { from: 'Ana', kind: 'person', text: 'held while behind' });
  const mid = lines(seat).length;
  t.mock.timers.tick(3 * 60 * 1000 + 1000);
  await fedseats.ensureAll();
  await settle();
  const out2 = lines(seat).slice(mid).map((f) => fedseal.open({ 0: k0 }, 'room-5192-room', f)).filter(Boolean);
  assert.deepStrictEqual(out2.map((o) => o.m.text), ['held while behind'], 'the pass did not flush after the hold ran out');
  void h;
});

test('#5192: an owner seat replaced while a hello was being checked does not flush its held posts through the new seat', async () => {
  const inv = newInvite('5192r');
  const { h, seat } = await ownerRoom('proj-5192-repl', 'ref-5192-repl', 'room-5192-repl', [inv]);
  fedseats.post('proj-5192-repl', { from: 'Josh', kind: 'person', text: 'held by the old seat' });
  let release;
  h.gate = new Promise((r) => { release = r; });
  say(seat, { event: 'message', data: fedseal.helloFrame(inv.s, inv.code, fedseal.newKeyPair(), 'room-5192-repl') });
  await settle();
  // The project is stopped and seated again while the hello waits on Kosmos+ (its request
  // already holds the gate; the new seat's own request must not).
  h.gate = null;
  fedseats.stop('proj-5192-repl');
  await fedseats.ensure('proj-5192-repl');
  const fresh = h.spawned[h.spawned.length - 1];
  assert.notStrictEqual(fresh, seat, 'fixture: a new seat');
  const notes = h.notes.length;
  release();
  await settle();
  assert.strictEqual(fresh.written.length, 0, 'the old seat\'s held post went out through the new seat');
  assert.ok(!h.notes.slice(notes).some((n) => /stayed on this computer/.test(n.text)), 'the old seat\'s held post was flushed into the new one: ' + JSON.stringify(h.notes.slice(notes)));
});

test('#5192: re-holding a post on each pass keeps its age, so the hour still runs out', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T00:00:00Z') });
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-age', { role: 'member', edge_id: 'edge-5192-age' });
  fedseal.setRoomState('proj-5192-age', { role: 'member', s: sk, code: 'code-5192age', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-age');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-age', expires_at: 9 });
  await settle();
  fedseats.post('proj-5192-age', { from: 'Ana', kind: 'person', text: 'old' });
  for (let i = 0; i < 61; i++) { t.mock.timers.tick(60 * 1000); await fedseats.ensureAll(); await settle(); }
  const before = lines(seat).length;
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192age', fedseal.newKeyPair(), fedseal.sealingKey().pub, fedseal.randomSecret(), 0, 'room-5192-age') });
  await settle();
  assert.strictEqual(lines(seat).length - before, 0, 'a post held for 61 minutes went out: the passes reset its age');
  assert.ok(h.notes.some((n) => /1 held message was not sent: held for more than an hour/.test(n.text)), JSON.stringify(h.notes));
});

test('#5192: a key that arrives while the seat is not connected keeps the posts held until it is', async () => {
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-down', { role: 'member', edge_id: 'edge-5192-down' });
  fedseal.setRoomState('proj-5192-down', { role: 'member', s: sk, code: 'code-5192down', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-down');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-down', expires_at: 9 });
  await settle();
  fedseats.post('proj-5192-down', { from: 'Ana', kind: 'person', text: 'waits' });
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'disconnected' });
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192down', fedseal.newKeyPair(), fedseal.sealingKey().pub, roomKey, 0, 'room-5192-down') });
  await settle();
  assert.ok(!h.notes.some((n) => /stayed on this computer: the connection/.test(n.text)), 'a held post was dropped while the seat was down: ' + JSON.stringify(h.notes));
  const before = lines(seat).length;
  say(seat, { event: 'connected', room: 'room-5192-down', expires_at: 10 });
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: roomKey }, 'room-5192-down', f)).filter(Boolean);
  assert.deepStrictEqual(out.map((o) => o.m.text), ['waits']);
});

test('#5192: a held post the write loses stays held for the next flush', async () => {
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-epipe', { role: 'member', edge_id: 'edge-5192-epipe' });
  fedseal.setRoomState('proj-5192-epipe', { role: 'member', s: sk, code: 'code-5192epipe', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-epipe');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-epipe', expires_at: 9 });
  await settle();
  fedseats.post('proj-5192-epipe', { from: 'Ana', kind: 'person', text: 'survives' });
  const realWrite = seat.stdin.write.bind(seat.stdin);
  let fail = true;
  seat.stdin.write = (chunk, ...rest) => {
    if (fail && /"ct"/.test(String(chunk))) { fail = false; throw new Error('EPIPE'); }
    return realWrite(chunk, ...rest);
  };
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192epipe', fedseal.newKeyPair(), fedseal.sealingKey().pub, roomKey, 0, 'room-5192-epipe') });
  await settle();
  const before = lines(seat).length;
  await fedseats.ensureAll();
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: roomKey }, 'room-5192-epipe', f)).filter(Boolean);
  assert.deepStrictEqual(out.map((o) => o.m.text), ['survives'], 'the post the write lost was not held again');
  void h;
});

test('#5192: what is held fits the receiving board\'s minute: held bytes are capped', async () => {
  const sk = fedseal.randomSecret();
  federation.recordLink('proj-5192-bytes', { role: 'member', edge_id: 'edge-5192-bytes' });
  fedseal.setRoomState('proj-5192-bytes', { role: 'member', s: sk, code: 'code-5192bytes', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-bytes');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-5192-bytes', expires_at: 9 });
  await settle();
  for (let i = 0; i < 45; i++) fedseats.post('proj-5192-bytes', { from: 'Ana', kind: 'person', text: String(i).padEnd(1500, '.') });
  assert.ok(h.notes.some((n) => /as many messages as Kosmos sends at once/.test(n.text)), 'held bytes were not capped');
  const before = lines(seat).length;
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.shareFrame(sk, 'code-5192bytes', fedseal.newKeyPair(), fedseal.sealingKey().pub, roomKey, 0, 'room-5192-bytes') });
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: roomKey }, 'room-5192-bytes', f)).filter(Boolean);
  const bytes = out.reduce((n, o) => n + Buffer.byteLength(o.m.text) + Buffer.byteLength(o.m.from), 0);
  assert.ok(bytes <= fedseats.INBOUND_BYTES_PER_WINDOW, 'one flush sent ' + bytes + ' bytes, more than a receiving board keeps in a minute');
  assert.ok(out.length >= 30, 'fixture: most were held');
});

test('#5192: a flush that meets an unreadable rooms record keeps the posts held for the next one', async (t) => {
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-5192-eio', { role: 'member', edge_id: 'edge-5192-eio' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-5192-eio', { role: 'member', s: fedseal.randomSecret(), code: 'code-5192eio', peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-5192-eio');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', expires_at: 9 });   // no room id yet: the post is held
  await settle();
  fedseats.post('proj-5192-eio', { from: 'Ana', kind: 'person', text: 'kept' });
  const broken = t.mock.method(fedseal, 'roomState', () => { throw new Error('EIO'); });
  say(seat, { event: 'connected', room: 'room-5192-eio', expires_at: 10 });
  await settle();
  broken.mock.restore();
  assert.ok(!h.notes.some((n) => /stayed on this computer/.test(n.text)), 'a held post was dropped on an unreadable record: ' + JSON.stringify(h.notes));
  const before = lines(seat).length;
  await fedseats.ensureAll();
  await settle();
  const out = lines(seat).slice(before).map((f) => fedseal.open({ 0: k0 }, 'room-5192-eio', f)).filter(Boolean);
  assert.deepStrictEqual(out.map((o) => o.m.text), ['kept']);
});

test('#5192: an owner\'s held post says it goes to the first computer that joins', async () => {
  const inv = newInvite('5192n');
  const { h } = await ownerRoom('proj-5192-note', 'ref-5192-note', 'room-5192-note', [inv]);
  fedseats.post('proj-5192-note', { from: 'Josh', kind: 'person', text: 'before anyone' });
  assert.ok(h.notes.some((n) => /sent to the first computer that joins with its key, if one joins within the hour/.test(n.text)), JSON.stringify(h.notes));
});

test('#5192: posts that age out with no key are reported at the next pass, not only when a key arrives', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T01:00:00Z') });
  federation.recordLink('proj-5192-quiet', { role: 'member', edge_id: 'edge-5192-quiet' });
  fedseal.setRoomState('proj-5192-quiet', { role: 'member', s: fedseal.randomSecret(), code: 'code-5192quiet', peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-5192-quiet');
  say(h.spawned[0], { event: 'connected', room: 'room-5192-quiet', expires_at: 9 });
  await settle();
  fedseats.post('proj-5192-quiet', { from: 'Ana', kind: 'person', text: 'never keyed' });
  t.mock.timers.tick(61 * 60 * 1000);
  await fedseats.ensureAll();
  await settle();
  assert.ok(h.notes.some((n) => /1 held message was not sent: held for more than an hour/.test(n.text)), JSON.stringify(h.notes));
});
