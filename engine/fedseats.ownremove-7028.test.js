'use strict';
// kosmos#7028: a sealed room's own computers can be taken out (retired on the account, or removed on the screen), and a
// computer taken out can ask to be let back in. Through a real seat and the fake connector, as
// engine/fedseats.ownseal-4658.test.js; the routes are server.ownremove-7028.test.js.
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fedseats-ownremove-7028-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const federation = require('./federation');
const fedseats = require('./fedseats');
const fedseal = require('./fedseal');
test.after(() => { fedseats.stopAll(); fs.rmSync(ROOT, { recursive: true, force: true }); });

const MY_MAC = 'mac-this-board';
const COMPUTERS = '/v1/mac/account-computers';

function fakeChild() {
  const c = new EventEmitter();
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.written = [];
  c.stdin.on('data', (d) => c.written.push(String(d)));
  return c;
}
/** The board's wiring. macRequest answers by route: the account's computers, or the edges. Each may be a function
    (called per request) or a value; `asked` records every route asked. */
function harness({ edges = [], computers = null } = {}) {
  const h = { spawned: [], notes: [], asked: [] };
  fedseats.stopAll();
  const answer = (v) => (typeof v === 'function' ? v() : v);
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); c.edge = edge; h.spawned.push(c); return c; },
    macRequest: async (method, route) => {
      h.asked.push(route);
      if (route === COMPUTERS) return answer(computers) || { ok: false, because: 'no answer' };
      return { ok: true, data: { as_owner: answer(edges), as_member: [] } };
    },
    recordExternal: () => {},
    enrolled: () => true,
    projectExists: () => true,
    note: (projectId, text) => h.notes.push({ projectId, text }),
    macId: () => MY_MAC,
  });
  return h;
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const say = (child, obj) => child.stdout.write(JSON.stringify(obj) + '\n');
const lines = (child) => child.written.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rows = (...macs) => ({ ok: true, data: { computers: [{ name: 'this', mac_id: MY_MAC, this: true }, ...macs.map((m) => ({ name: m, mac_id: m }))] } });

/* ---- the seal owner's side ---- */

/** A seal owner at epoch 0 with two own computers pinned (a on mac-a, b on mac-b) and no guest. */
async function ownerWithTwo(id, room, opts) {
  const ref = 'ref-' + id;
  federation.recordLink(id, { role: 'owner', ref, selfShared: true });
  const a = fedseal.newKeyPair();
  const b = fedseal.newKeyPair();
  fedseal.setRoomState(id, { role: 'owner', peers: {}, epoch: 0, keys: { 0: fedseal.randomSecret() },
    own: { [a.pub]: { mac: 'mac-a', at: 1 }, [b.pub]: { mac: 'mac-b', at: 2 } } });
  const h = harness(opts);
  await fedseats.ensure(id);
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room, expires_at: 9 });
  await settle();
  return { h, seat, a, b, link: { role: 'owner', ref } };
}
/** Whether `kp` can open any key-rotate frame the seat sent, at `epoch`. */
function canOpenRotate(seat, kp, room, epoch) {
  const owner = fedseal.sealingKey().pub;
  return lines(seat).filter((f) => f.t === 'key-rotate').some((f) => { const g = fedseal.openRotate(kp, owner, f, room); return !!g && g.epoch === epoch; });
}

test('#7028: a computer no longer on the account leaves the key, and only the one still on it gets the new key', async () => {
  const { seat, a, b, link } = await ownerWithTwo('rm-1', 'room-rm-1', { computers: rows('mac-a') });
  assert.strictEqual(await fedseats.rotateForRevoked('rm-1', link), true, 'no rotation for a computer gone from the account');
  const st = fedseal.roomState('rm-1');
  assert.strictEqual(st.epoch, 1);
  assert.deepStrictEqual(Object.keys(st.own), [a.pub], 'the retired computer is still pinned');
  assert.ok(Object.prototype.hasOwnProperty.call(st.keys, 0), 'the old key was dropped with a computer still in the room');
  assert.ok(canOpenRotate(seat, a, 'room-rm-1', 1), 'the computer still on the account did not get the new key');
  assert.ok(!canOpenRotate(seat, b, 'room-rm-1', 1), 'the retired computer got the new key');
});

test('#7028: with every own computer gone, the old key is dropped from the record too', async () => {
  await ownerWithTwo('rm-1b', 'room-rm-1b', { computers: rows() });
  assert.strictEqual(await fedseats.rotateForRevoked('rm-1b', { role: 'owner', ref: 'ref-rm-1b' }), true);
  const st = fedseal.roomState('rm-1b');
  assert.deepStrictEqual(st.own, {});
  assert.deepStrictEqual(Object.keys(st.keys), ['1'], 'a key nobody left in the room should hold is still kept');
});

for (const [why, computers] of [
  ['a failed answer', { ok: false, because: 'Kosmos+ did not answer' }],
  ['an answer with no list', { ok: true, data: {} }],
  ['an empty list', { ok: true, data: { computers: [] } }],
  ['a row with no mac id (an older coordinator)', { ok: true, data: { computers: [{ name: 'this', mac_id: MY_MAC, this: true }, { name: 'a' }] } }],
  ['no row for this computer', { ok: true, data: { computers: [{ name: 'a', mac_id: 'mac-a' }] } }],
  ['a row for this computer under another id (ids that are not the ones computers sign as)', { ok: true, data: { computers: [{ name: 'this', mac_id: 'some-other-id', this: true }, { name: 'a', mac_id: 'mac-a' }] } }],
  ['two rows that say they are this computer', { ok: true, data: { computers: [{ name: 'this', mac_id: MY_MAC, this: true }, { name: 'a', mac_id: 'mac-a', this: true }] } }],
]) {
  test('#7028: ' + why + ' takes nobody out', async () => {
    const id = 'rm-2-' + why.replace(/[^a-z]/g, '');
    await ownerWithTwo(id, 'room-' + id, { computers });
    assert.strictEqual(await fedseats.rotateForRevoked(id, { role: 'owner', ref: 'ref-' + id }), false);
    const st = fedseal.roomState(id);
    assert.strictEqual(st.epoch, 0);
    assert.strictEqual(Object.keys(st.own).length, 2);
  });
}

test('#7028: a failed computers answer does not make a room with a guest count as unchecked', async () => {
  const id = 'rm-3';
  const ref = 'ref-' + id;
  const { h } = await ownerWithTwo(id, 'room-' + id, { computers: { ok: false, because: 'down' }, edges: [{ id: 'edge-g', project_ref: ref, status: 'active' }] });
  const st = fedseal.roomState(id);
  fedseal.setRoomState(id, Object.assign({}, st, { peers: { 'pub-guest': { edge: 'edge-g' } } }));
  // rotateForRevoked only says whether it rotated; the check's own answer is what holds or releases guest posts.
  const asked = h.asked.length;
  assert.strictEqual(await fedseats.rotateForRevoked(id, { role: 'owner', ref }), false);
  assert.deepStrictEqual(h.asked.slice(asked).sort(), [COMPUTERS, fedseats.MAC_EDGES].sort(), 'both answers should be asked');
  const after = fedseal.roomState(id);
  assert.strictEqual(after.epoch, 0);
  assert.strictEqual(Object.keys(after.own).length, 2);
});

test('#7028: a computers list asked before a computer was pinned cannot drop it (the list is shared for 15 s)', async () => {
  const { a, b, link } = await ownerWithTwo('rm-4b', 'room-rm-4b', { computers: rows('mac-a') });
  // b was pinned after the list (shared for 15 s) was asked: it may not have been on the account yet.
  const st = fedseal.roomState('rm-4b');
  fedseal.setRoomState('rm-4b', Object.assign({}, st, { own: { [a.pub]: st.own[a.pub], [b.pub]: { mac: 'mac-b', at: Date.now() + 60 * 1000 } } }));
  assert.strictEqual(await fedseats.rotateForRevoked('rm-4b', link), false, 'a list from before the pin dropped the computer');
  assert.strictEqual(Object.keys(fedseal.roomState('rm-4b').own).length, 2);
});

test('#7028: the computers answer is shared by every room on this Mac for 15 seconds', async () => {
  const { h } = await ownerWithTwo('rm-4', 'room-rm-4', { computers: rows('mac-a', 'mac-b') });
  await fedseats.rotateForRevoked('rm-4', { role: 'owner', ref: 'ref-rm-4' });
  await fedseats.rotateForRevoked('rm-4', { role: 'owner', ref: 'ref-rm-4' });
  assert.strictEqual(h.asked.filter((r) => r === COMPUTERS).length, 1);
});

test('#7028: the screen lists the pinned computers and removes one, which moves the room to a key it is not sent', async () => {
  const { seat, a, b } = await ownerWithTwo('rm-5', 'room-rm-5', { computers: rows('mac-a', 'mac-b') });
  assert.deepStrictEqual(fedseats.ownAllowed('rm-5').map((c) => c.mac), ['mac-a', 'mac-b']);
  assert.deepStrictEqual(await fedseats.ownRemove('rm-5', 'pub-not-pinned'), { ok: false, because: 'that computer does not hold this room\'s key' });
  assert.deepStrictEqual(await fedseats.ownRemove('rm-5', b.pub), { ok: true, because: null });
  const st = fedseal.roomState('rm-5');
  assert.strictEqual(st.epoch, 1);
  assert.deepStrictEqual(Object.keys(st.own), [a.pub]);
  assert.ok(canOpenRotate(seat, a, 'room-rm-5', 1));
  assert.ok(!canOpenRotate(seat, b, 'room-rm-5', 1), 'the removed computer got the new key');
  assert.deepStrictEqual(fedseats.ownAllowed('rm-5').map((c) => c.mac), ['mac-a']);
});

test('#7028: a remove whose save fails and whose record then cannot be read says it did not happen', async (t) => {
  const { b } = await ownerWithTwo('rm-8', 'room-rm-8', { computers: rows('mac-a', 'mac-b') });
  const read = fedseal.roomState;
  let broken = false;
  t.mock.method(fedseal, 'setRoomState', () => { broken = true; throw new Error('disk full'); });
  t.mock.method(fedseal, 'roomState', (id) => { if (broken) throw new Error('unreadable'); return read(id); });
  const r = await fedseats.ownRemove('rm-8', b.pub);
  assert.strictEqual(r.ok, false, 'a remove that may not have happened was reported done');
});

test('#7028: a remove goes even when the guests\' edges cannot be read', async () => {
  const id = 'rm-6';
  const { b } = await ownerWithTwo(id, 'room-' + id, { computers: rows('mac-a', 'mac-b') });
  const st = fedseal.roomState(id);
  fedseal.setRoomState(id, Object.assign({}, st, { peers: { 'pub-guest': { edge: 'edge-g' } } }));
  fedseats.configure(Object.assign({}, { spawnSeat: () => fakeChild(), recordExternal: () => {}, enrolled: () => true, projectExists: () => true, note: () => {}, macId: () => MY_MAC },
    { macRequest: async (m, route) => (route === COMPUTERS ? rows('mac-a', 'mac-b') : { ok: false, because: 'down' }) }));
  assert.deepStrictEqual(await fedseats.ownRemove(id, b.pub), { ok: true, because: null });
  assert.ok(!Object.prototype.hasOwnProperty.call(fedseal.roomState(id).own, b.pub));
  assert.ok(fedseal.roomState(id).peers['pub-guest'], 'the guest was dropped on an unreadable answer');
});

test('#7028: a board that is not the seal owner lists nothing and removes nothing', async () => {
  federation.recordLink('rm-7', { role: 'self', ref: 'ref-rm-7' });
  fedseal.setRoomState('rm-7', { role: 'member', ownComputer: true, keys: {} });
  assert.deepStrictEqual(fedseats.ownAllowed('rm-7'), []);
  assert.strictEqual((await fedseats.ownRemove('rm-7', 'pub-x')).ok, false);
});

/* ---- the own computer's side: a sealed-looking frame is never undone from outside ---- */

/* kosmos#7028 part 3 is decided NOT built (plan, review round 2): in an own room the only senders are this account's
   computers and the relay, both of which can already deny service, and clearing a seal on a Kosmos+ answer would let
   a dishonest coordinator downgrade a real one. This pins that nothing asks or clears. */
test('#7028: an own computer keeps a sealed record whatever Kosmos+ says about edges, and asks nothing', async () => {
  federation.recordLink('fg-1', { role: 'self', ref: 'ref-fg-1' });
  const h = harness({ edges: [] });
  await fedseats.ensure('fg-1');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-fg-1', expires_at: 9 });
  await settle();
  const asked = h.asked.length;
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-fg-1', { from: 'x', kind: 'person', text: 'sealed' }) });
  await settle();
  await new Promise((r) => setTimeout(r, 50));
  await settle();
  const st = fedseal.roomState('fg-1');
  assert.ok(st && st.ownComputer === true, 'a sealed record was cleared');
  assert.deepStrictEqual(h.asked.slice(asked), [], 'a sealed-looking frame made the own computer ask Kosmos+');
  fedseats.post('fg-1', { from: 'Josh', kind: 'person', text: 'must not go in the clear' });
  await settle();
  assert.ok(!seat.written.join('').includes('must not go in the clear'));
});

/* ---- an own computer taken out of the key asks to be let back in ---- */

/** An own computer holding the key at epoch 0, connected. */
async function adoptedOwn(id, room) {
  federation.recordLink(id, { role: 'self', ref: 'ref-' + id });
  fedseal.setRoomState(id, { role: 'member', ownComputer: true, peer: fedseal.newKeyPair().pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure(id);
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room, expires_at: 9 });
  await settle();
  return { h, seat };
}
const ahead = (room) => ({ event: 'message', data: fedseal.seal(fedseal.randomSecret(), 1, room, { from: 'x', kind: 'person', text: 'newer key' }) });
const hellos = (seat) => lines(seat).filter((f) => f.t === 'key-own-hello').length;

test('#7028: an own computer still behind ten minutes after it first saw a newer key drops its old one and asks again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { h, seat } = await adoptedOwn('rj-1', 'room-rj-1');
  say(seat, ahead('room-rj-1'));
  await settle();
  t.mock.timers.tick(9 * 60 * 1000);
  say(seat, ahead('room-rj-1'));
  await settle();
  assert.strictEqual(fedseal.roomState('rj-1').epoch, 0, 'it gave up its key before ten minutes');
  assert.strictEqual(hellos(seat), 0);
  t.mock.timers.tick(60 * 1000);
  say(seat, ahead('room-rj-1'));
  await settle();
  const st = fedseal.roomState('rj-1');
  assert.deepStrictEqual({ role: st.role, ownComputer: st.ownComputer, keys: st.keys }, { role: 'member', ownComputer: true, keys: {} }, 'the old key was kept');
  assert.strictEqual(hellos(seat), 1, 'it did not ask to be let back in');
  assert.ok(h.notes.some((n) => n.projectId === 'rj-1' && /compare the code/.test(n.text)), 'the person was not told');
  // Nothing goes out at all: neither in the clear nor sealed under the dropped key.
  const before = lines(seat).length;
  fedseats.post('rj-1', { from: 'Josh', kind: 'person', text: 'held after the rejoin' });
  await settle();
  assert.deepStrictEqual(lines(seat).slice(before).filter((f) => f.t !== 'key-own-hello'), [], 'a post went out after the rejoin');
});

test('#7028: time away does not count: a reconnect restarts the ten minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { seat } = await adoptedOwn('rj-3', 'room-rj-3');
  say(seat, ahead('room-rj-3'));
  await settle();
  t.mock.timers.tick(9 * 60 * 1000);
  say(seat, { event: 'disconnected' });
  await settle();
  say(seat, { event: 'connected', room: 'room-rj-3', expires_at: 9 });   // it was away, and is back
  await settle();
  t.mock.timers.tick(2 * 60 * 1000);
  say(seat, ahead('room-rj-3'));
  await settle();
  assert.strictEqual(fedseal.roomState('rj-3').epoch, 0, 'time before the reconnect counted toward giving up the key');
  assert.strictEqual(hellos(seat), 0);
  t.mock.timers.tick(8 * 60 * 1000);
  say(seat, ahead('room-rj-3'));
  await settle();
  assert.deepStrictEqual(fedseal.roomState('rj-3').keys, {}, 'ten connected minutes behind did not rejoin');
});

test('#7028: a ticket renewal (connected again with no drop) does not restart the ten minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { seat } = await adoptedOwn('rj-5', 'room-rj-5');
  say(seat, ahead('room-rj-5'));
  await settle();
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(4 * 60 * 1000);
    say(seat, { event: 'connected', room: 'room-rj-5', expires_at: 9 });   // renewal: never disconnected
    await settle();
  }
  say(seat, ahead('room-rj-5'));
  await settle();
  assert.deepStrictEqual(fedseal.roomState('rj-5').keys, {}, 'renewals kept a removed computer from ever asking again');
});

test('#7028: a computer that caught up on a rotation and then falls behind again starts its ten minutes over', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { seat } = await adoptedOwn('rj-4', 'room-rj-4');
  say(seat, ahead('room-rj-4'));
  await settle();
  t.mock.timers.tick(11 * 60 * 1000);
  // It catches up to epoch 1 (as a key-rotate adoption would), then sees epoch 2.
  const st = fedseal.roomState('rj-4');
  fedseal.setRoomState('rj-4', Object.assign({}, st, { epoch: 1, keys: Object.assign({}, st.keys, { 1: fedseal.randomSecret() }) }));
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 2, 'room-rj-4', { from: 'x', kind: 'person', text: 'newer' }) });
  await settle();
  assert.strictEqual(fedseal.roomState('rj-4').epoch, 1, 'a fresh fall-behind rejoined at once on the old clock');
});

test('#7028: a guest that is behind keeps its key (only an own computer rejoins)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  federation.recordLink('rj-2', { role: 'member', ref: 'ref-rj-2', edge_id: 'e' });
  fedseal.setRoomState('rj-2', { role: 'member', s: fedseal.randomSecret(), code: 'c', peer: fedseal.newKeyPair().pub, epoch: 0, keys: { 0: fedseal.randomSecret() } });
  const h = harness();
  await fedseats.ensure('rj-2');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-rj-2', expires_at: 9 });
  await settle();
  say(seat, ahead('room-rj-2'));
  await settle();
  t.mock.timers.tick(11 * 60 * 1000);
  say(seat, ahead('room-rj-2'));
  await settle();
  assert.strictEqual(fedseal.roomState('rj-2').epoch, 0);
  assert.ok(fedseal.roomState('rj-2').keys[0], 'a guest dropped its key');
});
