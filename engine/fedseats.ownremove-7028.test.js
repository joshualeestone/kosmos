'use strict';
// kosmos#7028: a sealed room's own computers can be taken out (retired on the account, or removed on the screen), and a
// forged sealed-looking frame cannot lock an own computer's unsealed room. Through a real seat and the fake connector,
// as engine/fedseats.ownseal-4658.test.js; the routes are server.ownremove-7028.test.js.
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
      if (h.gate) await h.gate;   // a test holds the answer back
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

/* ---- the own computer's side: a forged sealed-looking frame ---- */

async function ownComputer(id, room, opts) {
  federation.recordLink(id, { role: 'self', ref: 'ref-' + id });
  const h = harness(opts);
  await fedseats.ensure(id);
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room, expires_at: 9 });
  await settle();
  return { h, seat };
}
const forged = (room) => ({ event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, room, { from: 'x', kind: 'person', text: 'forged' }) });

test('#7028: Kosmos+ lists no edge for the project, so a sealed-looking frame is forged: the record clears, and a post held meanwhile is told, never sent in the clear', async () => {
  const { h, seat } = await ownComputer('fg-1', 'room-fg-1', { edges: [{ id: 'other', project_ref: 'ref-somewhere-else', status: 'active' }] });
  let release;
  h.gate = new Promise((r) => { release = r; });
  say(seat, forged('room-fg-1'));
  await settle();
  // The answer is still out: the room reads sealed with no key, so the post is held, not sent.
  fedseats.post('fg-1', { from: 'Josh', kind: 'person', text: 'held then sent' });
  await settle();
  assert.ok(!seat.written.join('').includes('held then sent'), 'a post went out while the room read sealed');
  h.gate = null;
  release();
  await settle();
  assert.strictEqual(fedseal.roomState('fg-1'), null, 'the keyless record survived a "never sealed" answer');
  // Written while the room read sealed, so it never leaves in the clear (sendPost's sealedHeld rule); the person is
  // told now, not after the hour a held post waits.
  assert.ok(!seat.written.join('').includes('held then sent'), 'a post written for a sealed room went out in the clear');
  assert.ok(h.notes.some((n) => n.projectId === 'fg-1' && /held message was not sent/.test(n.text)), 'the held post was not told');
  fedseats.post('fg-1', { from: 'Josh', kind: 'person', text: 'after the clear' });
  await settle();
  assert.ok(seat.written.join('').includes('after the clear'), 'a new post after the clear did not go');
  // A second forged frame within the cooldown records nothing and asks nothing.
  const asked = h.asked.length;
  say(seat, forged('room-fg-1'));
  await settle();
  assert.strictEqual(fedseal.roomState('fg-1'), null, 'a forged frame flipped the room back to sealed');
  assert.strictEqual(h.asked.length, asked);
  assert.ok(h.notes.some((n) => n.projectId === 'fg-1' && /never sealed/.test(n.text)));
});

for (const [why, edges] of [
  ['an active edge', [{ id: 'e', project_ref: 'ref-fg-2', status: 'active' }]],
  ['a revoked edge (the room was sealed once)', [{ id: 'e', project_ref: 'ref-fg-2', status: 'revoked' }]],
]) {
  test('#7028: with ' + why + ' for the project, the sealed record is kept', async () => {
    fedseal.forgetRoom('fg-2');
    const { seat } = await ownComputer('fg-2', 'room-fg-2', { edges });
    say(seat, forged('room-fg-2'));
    await settle();
    const st = fedseal.roomState('fg-2');
    assert.ok(st && st.ownComputer === true, 'the sealed record was cleared');
  });
}

test('#7028: a failed edges answer keeps the sealed record', async () => {
  federation.recordLink('fg-3', { role: 'self', ref: 'ref-fg-3' });
  const h = harness();
  fedseats.configure({ spawnSeat: (e) => { const c = fakeChild(); h.spawned.push(c); return c; }, recordExternal: () => {}, enrolled: () => true, projectExists: () => true,
    note: () => {}, macId: () => MY_MAC, macRequest: async () => ({ ok: false, because: 'down' }) });
  await fedseats.ensure('fg-3');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-fg-3', expires_at: 9 });
  await settle();
  say(seat, forged('room-fg-3'));
  await settle();
  assert.ok(fedseal.roomState('fg-3') && fedseal.roomState('fg-3').ownComputer === true);
});

test('#7028: the check is asked fresh, never from an answer asked before the frame', async () => {
  let edges = [];
  federation.recordLink('fg-4a', { role: 'self', ref: 'ref-fg-4a' });
  federation.recordLink('fg-4b', { role: 'self', ref: 'ref-fg-4b' });
  const h = harness({ edges: () => edges });
  await fedseats.ensure('fg-4a');
  await fedseats.ensure('fg-4b');
  const [sa, sb] = h.spawned;
  say(sa, { event: 'connected', room: 'room-fg-4a', expires_at: 9 });
  say(sb, { event: 'connected', room: 'room-fg-4b', expires_at: 9 });
  await settle();
  // Room a's check caches an answer with no edges (fresh for 15 s); then room b's edge appears.
  say(sa, forged('room-fg-4a'));
  await settle();
  assert.strictEqual(fedseal.roomState('fg-4a'), null);
  edges = [{ id: 'e', project_ref: 'ref-fg-4b', status: 'active' }];
  say(sb, forged('room-fg-4b'));
  await settle();
  assert.ok(fedseal.roomState('fg-4b') && fedseal.roomState('fg-4b').ownComputer === true, 'an answer asked before the frame cleared a real seal');
  assert.strictEqual(h.asked.filter((r) => r === fedseats.MAC_EDGES).length, 2);
});
