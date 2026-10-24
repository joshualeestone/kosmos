'use strict';
// kosmos#4658: the owner's own computers in a sealed room, through a real seat and the fake connector.
// One board per process (its sealing key is a file), so each test drives one board and plays the
// other side with fedseal's primitives.
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fedseats-own-4658-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const federation = require('./federation');
const fedseats = require('./fedseats');
const fedseal = require('./fedseal');
test.after(() => { fedseats.stopAll(); fs.rmSync(ROOT, { recursive: true, force: true }); });

const MY_MAC = 'mac-this-board';

function fakeChild() {
  const c = new EventEmitter();
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.written = [];
  c.stdin.on('data', (d) => c.written.push(String(d)));
  return c;
}
function harness({ edges = [], macId = () => MY_MAC } = {}) {
  const h = { spawned: [], recorded: [], notes: [] };
  fedseats.stopAll();
  fedseats.configure({
    spawnSeat: (edge) => { const c = fakeChild(); c.edge = edge; h.spawned.push(c); return c; },
    macRequest: async () => ({ ok: true, data: { as_owner: edges, as_member: [] } }),
    recordExternal: (projectId, msg) => h.recorded.push({ projectId, ...msg }),
    enrolled: () => true,
    projectExists: () => true,
    note: (projectId, text) => h.notes.push({ projectId, text }),
    macId,
  });
  return h;
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };
const say = (child, obj) => child.stdout.write(JSON.stringify(obj) + '\n');
const lines = (child) => child.written.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The seal owner's board: an owner project whose room is sealed at epoch 0, seat connected. */
async function sealOwner(id, room) {
  const ref = 'ref-' + id;
  federation.recordLink(id, { role: 'owner', ref, selfShared: true });
  const roomKey = fedseal.randomSecret();
  fedseal.setRoomState(id, { role: 'owner', peers: {}, epoch: 0, keys: { 0: roomKey } });
  const h = harness({ edges: [{ id: 'edge-' + id, project_ref: ref, status: 'active' }] });
  await fedseats.ensure(id);
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room, expires_at: 9 });
  await settle();
  return { h, seat, roomKey };
}

test('#4658: the seal owner lists an own computer\'s hello with the code that computer shows', async () => {
  const { seat } = await sealOwner('own-o1', 'room-o1');
  const w = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-w') });
  await settle();
  const list = fedseats.ownWaiting('own-o1');
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].pub, w.pub);
  assert.strictEqual(list[0].mac, 'mac-w');
  assert.strictEqual(list[0].code, fedseal.compareCode('room-o1', 'mac-w', w.pub));
  assert.deepStrictEqual(lines(seat), [], 'nothing is sent before a person allows it');
  assert.deepStrictEqual(fedseal.roomState('own-o1').own, undefined, 'nothing is pinned before a person allows it');
});

test('#4658: Allow with the wrong code sends nothing and pins nothing; with the right code the computer gets the key', async () => {
  const { seat, roomKey } = await sealOwner('own-o2', 'room-o2');
  const w = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-w2') });
  await settle();
  const wrong = await fedseats.allowOwn('own-o2', w.pub, fedseal.compareCode('room-o2', 'mac-w2', fedseal.newKeyPair().pub));
  assert.strictEqual(wrong.ok, false);
  assert.deepStrictEqual(lines(seat), []);
  assert.strictEqual(fedseal.roomState('own-o2').own, undefined);

  const ok = await fedseats.allowOwn('own-o2', w.pub, fedseal.compareCode('room-o2', 'mac-w2', w.pub));
  assert.deepStrictEqual(ok, { ok: true, because: null });
  const [share] = lines(seat);
  assert.strictEqual(share.t, 'key-own-share');
  assert.deepStrictEqual(fedseal.openOwnShare(w, 'mac-w2', share, 'room-o2'), { ownerPub: fedseal.sealingKey().pub, epoch: 0, roomKey });
  const st = fedseal.roomState('own-o2');
  assert.strictEqual(st.own[w.pub].mac, 'mac-w2', 'pinned as an own computer');
  assert.deepStrictEqual(st.peers, {}, 'never pinned as a guest peer');
  assert.deepStrictEqual(fedseats.ownWaiting('own-o2'), [], 'no longer waiting');
});

test('#4658: an allowed own computer that says hello again is sent its key again, without a new Allow', async () => {
  const { seat } = await sealOwner('own-o3', 'room-o3');
  const w = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-w3') });
  await settle();
  await fedseats.allowOwn('own-o3', w.pub, fedseal.compareCode('room-o3', 'mac-w3', w.pub));
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-w3') });
  await settle();
  const shares = lines(seat).filter((f) => f.t === 'key-own-share');
  assert.strictEqual(shares.length, 2);
  assert.ok(fedseal.openOwnShare(w, 'mac-w3', shares[1], 'room-o3'));
  // The same key under another computer id is not the pinned computer: it waits like a new one.
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-other') });
  await settle();
  assert.strictEqual(lines(seat).filter((f) => f.t === 'key-own-share').length, 2);
});

test('#4658: a rotation reaches an allowed own computer under the owner\'s key', async () => {
  const { seat } = await sealOwner('own-o4', 'room-o4');
  const w = fedseal.newKeyPair();
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-w4') });
  await settle();
  await fedseats.allowOwn('own-o4', w.pub, fedseal.compareCode('room-o4', 'mac-w4', w.pub));
  // Move the room to epoch 1 as a revoke would, then reconnect: sendRotates runs on connect.
  const st = fedseal.roomState('own-o4');
  const next = fedseal.randomSecret();
  fedseal.setRoomState('own-o4', Object.assign({}, st, { epoch: 1, keys: Object.assign({}, st.keys, { 1: next }), rotatedAt: Date.now() }));
  say(seat, { event: 'connected', room: 'room-o4', expires_at: 9 });
  await settle();
  const rot = lines(seat).filter((f) => f.t === 'key-rotate');
  assert.strictEqual(rot.length, 1, 'one rotate, to the own computer');
  const got = fedseal.openRotate(w, fedseal.sealingKey().pub, rot[0], 'room-o4');
  assert.strictEqual(got && got.roomKey, next);
});

test('#4658: a board without the room\'s key (an unsealed room) keeps no waiting list', async () => {
  federation.recordLink('own-o5', { role: 'owner', ref: 'ref-own-o5', selfShared: true });
  const h = harness({ edges: [{ id: 'edge-o5', project_ref: 'ref-own-o5', status: 'active' }] });
  await fedseats.ensure('own-o5');
  say(h.spawned[0], { event: 'connected', room: 'room-o5', expires_at: 9 });
  await settle();
  say(h.spawned[0], { event: 'message', data: fedseal.ownHelloFrame(fedseal.newKeyPair(), 'mac-x') });
  await settle();
  assert.deepStrictEqual(fedseats.ownWaiting('own-o5'), []);
  assert.strictEqual((await fedseats.allowOwn('own-o5', 'nope', 'AAAAA-AAAAA')).ok, false);
});

test('#4658: the waiting list is bounded, oldest out first', async () => {
  const { seat } = await sealOwner('own-o6', 'room-o6');
  const keys = [];
  for (let i = 0; i < 20; i++) {
    const k = fedseal.newKeyPair();
    keys.push(k.pub);
    say(seat, { event: 'message', data: fedseal.ownHelloFrame(k, 'mac-' + i) });
  }
  await settle();
  const list = fedseats.ownWaiting('own-o6');
  assert.strictEqual(list.length, 16);
  assert.deepStrictEqual(list.map((x) => x.pub), keys.slice(4));
});

/* ---- the own computer's side ---- */

/** A `self` board: joined by own code, seat connected. */
async function ownComputer(id, room, opts) {
  federation.recordLink(id, { role: 'self', ref: 'ref-' + id });
  const h = harness(opts);
  await fedseats.ensure(id);
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room, expires_at: 9 });
  await settle();
  return { h, seat };
}

test('#4658: an own computer that sees its room sealed holds its posts, says hello with its key, and shows the code', async () => {
  const { h, seat } = await ownComputer('own-s1', 'room-s1');
  // Before the room is known sealed: a post goes in the clear, as today.
  assert.strictEqual(fedseats.post('own-s1', { from: 'Josh', kind: 'person', text: 'before' }), true);
  await settle();
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-s1', { from: 'Ada', kind: 'person', text: 'sealed' }) });
  await settle();
  const st = fedseal.roomState('own-s1');
  assert.strictEqual(st.role, 'member');
  assert.strictEqual(st.own, true);
  const hello = lines(seat).find((f) => f.t === 'key-own-hello');
  assert.ok(hello, 'no hello');
  const me = fedseal.sealingKey();
  assert.deepStrictEqual(fedseal.checkOwnHello(hello), { mac: MY_MAC, pub: me.pub });
  const code = fedseal.compareCode('room-s1', MY_MAC, me.pub);
  assert.ok(h.notes.some((n) => n.projectId === 'own-s1' && n.text.includes(code)), 'the code is not shown');
  const before = h.spawned[0].written.length;
  fedseats.post('own-s1', { from: 'Josh', kind: 'person', text: 'must not go in the clear' });
  await settle();
  assert.ok(!h.spawned[0].written.slice(before).join('').includes('must not go in the clear'), 'a post went out in the clear in a sealed room');
  assert.strictEqual(h.recorded.length, 0);
});

test('#4658: the own computer adopts a genuine own-share, then reads the room and seals its held post', async () => {
  const { h, seat } = await ownComputer('own-s2', 'room-s2');
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.seal(roomKey, 0, 'room-s2', { from: 'Ada', kind: 'person', text: 'first' }) });
  await settle();
  fedseats.post('own-s2', { from: 'Josh', kind: 'person', text: 'held until the key' });
  await settle();
  const owner = fedseal.newKeyPair();
  const me = fedseal.sealingKey();
  // A share for ANOTHER computer id is ignored.
  say(seat, { event: 'message', data: fedseal.ownShareFrame(owner, me.pub, 'mac-else', fedseal.compareCode('room-s2', 'mac-else', me.pub), roomKey, 0, 'room-s2') });
  await settle();
  assert.strictEqual(fedseal.roomState('own-s2').peer, undefined);
  say(seat, { event: 'message', data: fedseal.ownShareFrame(owner, me.pub, MY_MAC, fedseal.compareCode('room-s2', MY_MAC, me.pub), roomKey, 0, 'room-s2') });
  await settle();
  const st = fedseal.roomState('own-s2');
  assert.strictEqual(st.peer, owner.pub, 'the sealing board\'s key is pinned');
  assert.strictEqual(st.keys[0], roomKey);
  // The held post went out, sealed under the room key.
  const sealedOut = lines(seat).filter((f) => fedseal.isSealed(f));
  assert.ok(sealedOut.some((env) => { const o = fedseal.open({ 0: roomKey }, 'room-s2', env); return o && o.m && o.m.text === 'held until the key'; }), 'the held post was not sent sealed');
  say(seat, { event: 'message', data: fedseal.seal(roomKey, 0, 'room-s2', { from: 'Ada', kind: 'person', text: 'now readable' }) });
  await settle();
  assert.ok(h.recorded.some((r) => r.text === 'now readable'));
});

test('#4658: an own computer with no id (macId not wired) records the seal but says no hello', async () => {
  const { seat } = await ownComputer('own-s3', 'room-s3', { macId: () => null });
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-s3', { from: 'Ada', kind: 'person', text: 'x' }) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-s3').own, true, 'still holds its posts');
  assert.deepStrictEqual(lines(seat).filter((f) => f.t === 'key-own-hello'), []);
});

test('#4658: a guest member who sees an unopenable room is not turned into an own computer', async () => {
  federation.recordLink('own-g1', { role: 'member', edge_id: 'edge-g1' });
  const h = harness();
  await fedseats.ensure('own-g1');
  say(h.spawned[0], { event: 'connected', room: 'room-g1', expires_at: 9 });
  await settle();
  say(h.spawned[0], { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-g1', { from: 'Ada', kind: 'person', text: 'x' }) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-g1'), null, 'a guest got own seal state');
  assert.deepStrictEqual(lines(h.spawned[0]).filter((f) => f.t === 'key-own-hello'), []);
});

test('#4658: an own computer accepts a rotation from the board it pinned, and not from any other key', async () => {
  const { seat } = await ownComputer('own-s4', 'room-s4');
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.seal(roomKey, 0, 'room-s4', { from: 'Ada', kind: 'person', text: 'x' }) });
  await settle();
  const owner = fedseal.newKeyPair();
  const me = fedseal.sealingKey();
  say(seat, { event: 'message', data: fedseal.ownShareFrame(owner, me.pub, MY_MAC, fedseal.compareCode('room-s4', MY_MAC, me.pub), roomKey, 0, 'room-s4') });
  await settle();
  const forged = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(fedseal.newKeyPair(), me.pub, forged, 1, 'room-s4', Date.now()) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-s4').epoch, 0, 'a rotation from an unpinned key was taken');
  const next = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(owner, me.pub, next, 1, 'room-s4', Date.now()) });
  await settle();
  const st = fedseal.roomState('own-s4');
  assert.strictEqual(st.epoch, 1);
  assert.strictEqual(st.keys[1], next);
});
