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
      if (gate) await gate;
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
  const h = harness({ edges: [{ id: 'edge-o1', project_ref: 'ref-macl', status: 'active' }] });
  await fedseats.ensure('proj-macl');
  await fedseats.ensure('proj-macm');
  const [owner, member] = h.spawned;
  say(owner, { event: 'ended', because: 'Kosmos+ refused this Mac: unknown mac (HTTP 401 on /v1/mac/federation/room-ticket)' });
  say(member, { event: 'ended', because: 'Kosmos+ refused this Mac: this Mac was retired (HTTP 401 on /v1/mac/federation/room-ticket)' });
  await tick();
  owner.emit('exit', 3);
  member.emit('exit', 3);
  assert.strictEqual(federation.linkFor('proj-macl').refused, undefined, 'the edge was refused for a Mac-level reason');
  assert.strictEqual(federation.linkFor('proj-macm').ended, undefined, 'the membership was ended for a Mac-level reason');
  assert.strictEqual(fedseats.statusOf('proj-macm'), 'reconnecting', 'a Mac-level refusal is a slow retry, not an ending');
  const notes = h.notes.filter((n) => n.projectId === 'proj-macm');
  assert.ok(notes.some((n) => /Sign in to Kosmos\+ again/.test(n.text)), JSON.stringify(notes));
  assert.ok(!notes.some((n) => /ask the owner/.test(n.text)), 'told to ask for a new code when signing in fixes it');
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

test('#3728: the owner shares the room key with a member who knows the invite half, and a stranger gets nothing', async () => {
  const s = fedseal.randomSecret();
  fedseal.stashInviteSecret('ref-seal-o', s);
  federation.recordLink('proj-seal-o', { role: 'owner', ref: 'ref-seal-o' });
  const h = harness({ edges: [{ id: 'edge-so', project_ref: 'ref-seal-o', status: 'active' }] });
  await fedseats.ensure('proj-seal-o');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-so', expires_at: 9 });
  await tick();
  // Someone without the half (the relay, the coordinator, another member): no share, no word.
  const stranger = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(fedseal.randomSecret(), stranger, 'room-so') });
  await tick();
  assert.strictEqual(lines(seat).length, 0, 'a stranger was answered');
  const member = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(s, member, 'room-so') });
  await tick();
  const [share] = lines(seat);
  assert.strictEqual(share && share.t, 'key-share');
  const got = fedseal.openShare(s, member, share, 'room-so');
  assert.ok(got, 'the member could not open the owner\'s share');
  assert.strictEqual(got.ownerPub, fedseal.sealingKey().pub, 'the share did not come from this board\'s key');
  assert.deepStrictEqual(fedseal.inviteSecretsFor('ref-seal-o'), [], 'the invite half was not spent');
  assert.strictEqual(h.recorded.length, 0, 'a key frame was recorded as a row');
  // From here the owner's posts leave sealed, and only the member's key opens them.
  assert.strictEqual(fedseats.post('proj-seal-o', { from: 'Josh', kind: 'person', text: 'secret words' }), true);
  const out = lines(seat).pop();
  assert.ok(fedseal.isSealed(out) && !JSON.stringify(out).includes('secret words'), 'the post left in the clear: ' + JSON.stringify(out));
  assert.strictEqual(fedseal.open({ [got.epoch]: got.roomKey }, 'room-so', out).text, 'secret words');
  // The member reconnects and says hello again (its share was lost): answered again from the pin.
  say(seat, { event: 'message', data: fedseal.helloFrame(s, member, 'room-so') });
  await tick();
  const again = lines(seat).pop();
  assert.strictEqual(again.t, 'key-share');
  assert.strictEqual(fedseal.openShare(s, member, again, 'room-so').roomKey, got.roomKey, 'a reconnect got a different room key');
});

test('#3728: a member says hello, holds its posts until the key arrives, then seals out and opens in, and refuses a downgrade', async () => {
  const s = fedseal.randomSecret();
  federation.recordLink('proj-seal-m', { role: 'member', edge_id: 'edge-sm' });
  fedseal.setRoomState('proj-seal-m', { role: 'member', s, peer: null, epoch: null, keys: {} });
  const h = harness();
  await fedseats.ensure('proj-seal-m');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-sm', expires_at: 9 });
  await tick();
  const [hello] = lines(seat);
  const me = fedseal.sealingKey();
  assert.strictEqual(fedseal.checkHello(s, hello, 'room-sm'), me.pub, 'the member did not say a genuine hello');
  // Before the key: nothing leaves, and the room says why.
  assert.strictEqual(fedseats.post('proj-seal-m', { from: 'Ana', kind: 'person', text: 'too early' }), false);
  assert.ok(h.notes.some((n) => /has not shared its key yet/.test(n.text)), JSON.stringify(h.notes));
  assert.strictEqual(lines(seat).length, 1, 'a post went out before the room had a key');
  // The owner (played here) shares the key.
  const owner = fedseal.newKeyPair();
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.shareFrame(s, owner, me.pub, roomKey, 0, 'room-sm') });
  await tick();
  assert.deepStrictEqual(fedseal.roomState('proj-seal-m').keys, { 0: roomKey });
  assert.strictEqual(fedseal.roomState('proj-seal-m').peer, owner.pub, 'the owner key was not pinned');
  assert.ok(h.notes.some((n) => /This shared room is sealed/.test(n.text)));
  // Posts leave sealed.
  assert.strictEqual(fedseats.post('proj-seal-m', { from: 'Ana', kind: 'person', text: 'now sealed' }), true);
  const out = lines(seat).pop();
  assert.ok(fedseal.isSealed(out) && !JSON.stringify(out).includes('now sealed'));
  // A sealed message from the owner is opened and recorded like any outside row.
  say(seat, { event: 'message', data: fedseal.seal(roomKey, 0, 'room-sm', { from: 'Owner', kind: 'person', text: 'hello member' }) });
  await tick();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['hello member']);
  // Words in the clear in a sealed room are not shown; nor is a seal this board cannot open.
  say(seat, { event: 'message', data: { from: 'Mallory', kind: 'person', text: 'downgrade' } });
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-sm', { from: 'Mallory', kind: 'person', text: 'wrong key' }) });
  await tick();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['hello member'], 'a downgraded or unopenable message was shown');
  assert.ok(h.notes.some((n) => /arrived unsealed/.test(n.text)));
  assert.ok(h.notes.some((n) => /could not open/.test(n.text)));
});

test('#3728: a room with no seal state (before sealing, or an older owner) posts and shows in the clear, as before', async () => {
  federation.recordLink('proj-legacy-clear', { role: 'member', edge_id: 'edge-lc' });
  const h = harness();
  await fedseats.ensure('proj-legacy-clear');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-lc', expires_at: 9 });
  await tick();
  assert.strictEqual(lines(seat).length, 0, 'a room with no seal state said hello');
  assert.strictEqual(fedseats.post('proj-legacy-clear', { from: 'Ana', kind: 'person', text: 'plain' }), true);
  assert.strictEqual(lines(seat).pop().text, 'plain');
  say(seat, { event: 'message', data: { from: 'Owner', kind: 'person', text: 'plain back' } });
  await tick();
  assert.deepStrictEqual(h.recorded.map((r) => r.text), ['plain back']);
});

test('#3728: a revoked member is rotated out: the rest get the next key, the revoked one gets nothing it can open', async () => {
  const sA = fedseal.randomSecret();
  const sB = fedseal.randomSecret();
  fedseal.stashInviteSecret('ref-rot', sA);
  fedseal.stashInviteSecret('ref-rot', sB);
  federation.recordLink('proj-rot', { role: 'owner', ref: 'ref-rot' });
  const h = harness({ edges: [{ id: 'edge-a', project_ref: 'ref-rot', status: 'active' }, { id: 'edge-b', project_ref: 'ref-rot', status: 'active' }] });
  await fedseats.ensure('proj-rot');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-rot', expires_at: 9 });
  await tick();
  const a = fedseal.newKeyPair();
  const b = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.helloFrame(sA, a, 'room-rot', 'edge-a') });
  say(seat, { event: 'message', data: fedseal.helloFrame(sB, b, 'room-rot', 'edge-b') });
  await tick();
  assert.deepStrictEqual(Object.keys(fedseal.roomState('proj-rot').peers).sort(), [a.pub, b.pub].sort(), 'fixture: both members pinned');
  // Nothing changes while both edges are active.
  assert.strictEqual(await fedseats.rotateForRevoked('proj-rot', federation.linkFor('proj-rot'), null), false);
  assert.strictEqual(fedseal.roomState('proj-rot').epoch, 0);
  // The owner revokes A (the coordinator now reports its edge revoked).
  h.edges = [{ id: 'edge-a', project_ref: 'ref-rot', status: 'revoked' }, { id: 'edge-b', project_ref: 'ref-rot', status: 'active' }];
  const before = lines(seat).length;
  assert.strictEqual(await fedseats.rotateForRevoked('proj-rot', federation.linkFor('proj-rot'), null), true);
  const st = fedseal.roomState('proj-rot');
  assert.strictEqual(st.epoch, 1);
  assert.deepStrictEqual(Object.keys(st.peers), [b.pub], 'the revoked member is still pinned');
  const rotates = lines(seat).slice(before).filter((f) => f.t === 'key-rotate');
  assert.strictEqual(rotates.length, 1, 'rotates sent: ' + rotates.length);
  const ownerPub = fedseal.sealingKey().pub;
  assert.deepStrictEqual(fedseal.openRotate(b, ownerPub, rotates[0], 'room-rot'), { epoch: 1, roomKey: st.keys[1] });
  assert.strictEqual(fedseal.openRotate(a, ownerPub, rotates[0], 'room-rot'), null, 'the revoked member opened the next key');
  // Posts now use epoch 1, which A's epoch-0 key cannot open.
  const shareA = lines(seat).find((f) => f.t === 'key-share' && fedseal.openShare(sA, a, f, 'room-rot'));
  const keyA = fedseal.openShare(sA, a, shareA, 'room-rot').roomKey;
  assert.strictEqual(fedseats.post('proj-rot', { from: 'Owner', kind: 'person', text: 'after revoke' }), true);
  const out = lines(seat).pop();
  assert.strictEqual(out.epoch, 1);
  assert.strictEqual(fedseal.open({ 0: keyA }, 'room-rot', out), null, 'the revoked member read a post after the revoke');
  assert.strictEqual(fedseal.open({ 1: st.keys[1] }, 'room-rot', out).text, 'after revoke');
  // A reconnect re-sends the current rotate to the remaining member.
  const n = lines(seat).length;
  say(seat, { event: 'connected', room: 'room-rot', expires_at: 10 });
  await tick();
  assert.ok(lines(seat).slice(n).some((f) => f.t === 'key-rotate' && fedseal.openRotate(b, ownerPub, f, 'room-rot')), 'a reconnect did not re-send the rotate');
});

test('#3728: an edge the coordinator does not list is not taken as revoked', async () => {
  const s1 = fedseal.randomSecret();
  fedseal.stashInviteSecret('ref-rot2', s1);
  federation.recordLink('proj-rot2', { role: 'owner', ref: 'ref-rot2' });
  const h = harness({ edges: [{ id: 'edge-x', project_ref: 'ref-rot2', status: 'active' }] });
  await fedseats.ensure('proj-rot2');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-rot2', expires_at: 9 });
  await tick();
  say(seat, { event: 'message', data: fedseal.helloFrame(s1, fedseal.newKeyPair(), 'room-rot2', 'edge-x') });
  await tick();
  h.edges = [];
  assert.strictEqual(await fedseats.rotateForRevoked('proj-rot2', federation.linkFor('proj-rot2'), null), false);
  assert.strictEqual(fedseal.roomState('proj-rot2').epoch, 0, 'a partial answer locked a member out');
});

test('#3728: a member takes a rotate only from the pinned owner, and moves to the new epoch', async () => {
  const s = fedseal.randomSecret();
  const owner = fedseal.newKeyPair();
  federation.recordLink('proj-rot-m', { role: 'member', edge_id: 'edge-rm' });
  const k0 = fedseal.randomSecret();
  fedseal.setRoomState('proj-rot-m', { role: 'member', s, peer: owner.pub, epoch: 0, keys: { 0: k0 } });
  const h = harness();
  await fedseats.ensure('proj-rot-m');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-rm', expires_at: 9 });
  await tick();
  const me = fedseal.sealingKey();
  const mallory = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.rotateFrame(mallory, me.pub, fedseal.randomSecret(), 1, 'room-rm') });
  await tick();
  assert.strictEqual(fedseal.roomState('proj-rot-m').epoch, 0, 'a rotate from an unpinned key was taken');
  const k1 = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, me.pub, k1, 1, 'room-rm') });
  await tick();
  assert.deepStrictEqual(fedseal.roomState('proj-rot-m').keys, { 0: k0, 1: k1 });
  assert.strictEqual(fedseal.roomState('proj-rot-m').epoch, 1);
  assert.strictEqual(fedseats.post('proj-rot-m', { from: 'Ana', kind: 'person', text: 'on the new key' }), true);
  assert.strictEqual(lines(seat).pop().epoch, 1);
});
