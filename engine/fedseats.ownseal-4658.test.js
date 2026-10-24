'use strict';
// kosmos#4658: the owner's own computers in a sealed room, through a real seat and the fake connector.
// One board per process (its sealing key is a file), so each test drives one board and plays the
// other side with fedseal's primitives. The exchange is on the card, comment 6381388572.
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
const sent = (child, t) => lines(child).filter((f) => f.t === t);

/* ---- the seal owner's side ---- */

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
/** A waiting computer played by hand: hello, take the owner's offer, reveal. Returns what it would hold. */
async function waitingRun(seat, room, mac = 'mac-w') {
  const w = fedseal.newKeyPair();
  const nW = fedseal.randomSecret();
  const commit = fedseal.ownCommit(nW);
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, mac, nW) });
  await settle();
  const offerFrame = sent(seat, 'key-own-offer').filter((f) => f.commit === commit).pop();
  const offer = fedseal.checkOwnOffer(offerFrame, mac, commit);
  return {
    w, nW, commit, offer, mac,
    reveal: async () => { say(seat, { event: 'message', data: fedseal.ownRevealFrame(mac, offer.ownerPub, nW) }); await settle(); },
    code: () => fedseal.compareCode(room, mac, w.pub, offer.ownerPub, nW, offer.nO),
  };
}

test('#4658: the seal owner answers a hello with an offer, and lists the computer only once its reveal opens its commitment', async () => {
  const { seat } = await sealOwner('own-o1', 'room-o1');
  const r = await waitingRun(seat, 'room-o1');
  assert.ok(r.offer, 'no offer for the hello');
  assert.strictEqual(r.offer.ownerPub, fedseal.sealingKey().pub);
  assert.deepStrictEqual(fedseats.ownWaiting('own-o1'), [], 'listed before the reveal, so its code could be ground');
  // A reveal that does not open the commitment lists nothing.
  say(seat, { event: 'message', data: fedseal.ownRevealFrame(r.mac, r.offer.ownerPub, fedseal.randomSecret()) });
  await settle();
  assert.deepStrictEqual(fedseats.ownWaiting('own-o1'), []);
  await r.reveal();
  const list = fedseats.ownWaiting('own-o1');
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual({ pub: list[0].pub, mac: list[0].mac, code: list[0].code }, { pub: r.w.pub, mac: 'mac-w', code: r.code() }, 'the two screens would show the same code');
  assert.deepStrictEqual(sent(seat, 'key-own-share'), [], 'nothing is sent before a person allows it');
  assert.strictEqual(fedseal.roomState('own-o1').own, undefined, 'nothing is pinned before a person allows it');
});

test('#4658: a hello repeated on reconnect gets the same offer; a new commitment gets a new nonce', async () => {
  const { seat } = await sealOwner('own-o1b', 'room-o1b');
  const w = fedseal.newKeyPair();
  const nW = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-r', nW) });
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-r', nW) });
  await settle();
  const [a, b] = sent(seat, 'key-own-offer');
  assert.strictEqual(a.nonce, b.nonce, 'the same hello was answered with two different runs');
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-r', fedseal.randomSecret()) });
  await settle();
  assert.notStrictEqual(sent(seat, 'key-own-offer').pop().nonce, a.nonce, 'a new commitment reused the owner nonce');
});

test('#4658: Allow with the wrong code sends nothing and pins nothing; with the right code the computer gets the key', async () => {
  const { seat, roomKey } = await sealOwner('own-o2', 'room-o2');
  const r = await waitingRun(seat, 'room-o2', 'mac-w2');
  await r.reveal();
  const wrong = await fedseats.allowOwn('own-o2', r.w.pub, fedseal.compareCode('room-o2', 'mac-w2', fedseal.newKeyPair().pub, r.offer.ownerPub, r.nW, r.offer.nO));
  assert.strictEqual(wrong.ok, false);
  assert.deepStrictEqual(sent(seat, 'key-own-share'), []);
  assert.strictEqual(fedseal.roomState('own-o2').own, undefined);

  assert.deepStrictEqual(await fedseats.allowOwn('own-o2', r.w.pub, r.code()), { ok: true, because: null });
  const [share] = sent(seat, 'key-own-share');
  assert.deepStrictEqual(fedseal.openOwnShare(r.w, 'mac-w2', r.offer.ownerPub, r.nW, r.offer.nO, share, 'room-o2'), { ownerPub: fedseal.sealingKey().pub, epoch: 0, roomKey });
  const st = fedseal.roomState('own-o2');
  assert.strictEqual(st.own[r.w.pub].mac, 'mac-w2', 'pinned as an own computer');
  assert.deepStrictEqual(st.peers, {}, 'never pinned as a guest peer');
  assert.deepStrictEqual(fedseats.ownWaiting('own-o2'), [], 'no longer waiting');
});

test('#4658: a pinned own computer that says hello again (lost its key, or a new id) runs the whole exchange again', async () => {
  const { seat } = await sealOwner('own-o3', 'room-o3');
  const r = await waitingRun(seat, 'room-o3', 'mac-w3');
  await r.reveal();
  await fedseats.allowOwn('own-o3', r.w.pub, r.code());
  // Same key, new id (a re-sign-in): it gets an offer and can be allowed again, rather than being ignored.
  const nW = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(r.w, 'mac-new', nW) });
  await settle();
  const offer = fedseal.checkOwnOffer(sent(seat, 'key-own-offer').pop(), 'mac-new', fedseal.ownCommit(nW));
  assert.ok(offer, 'a pinned key under a new id was ignored');
  assert.strictEqual(sent(seat, 'key-own-share').length, 1, 'a key was re-sent without a new Allow');
  say(seat, { event: 'message', data: fedseal.ownRevealFrame('mac-new', offer.ownerPub, nW) });
  await settle();
  const code = fedseal.compareCode('room-o3', 'mac-new', r.w.pub, offer.ownerPub, nW, offer.nO);
  assert.deepStrictEqual(await fedseats.allowOwn('own-o3', r.w.pub, code), { ok: true, because: null });
  assert.strictEqual(fedseal.roomState('own-o3').own[r.w.pub].mac, 'mac-new');
});

test('#4658: a rotation reaches an allowed own computer under the owner\'s key', async () => {
  const { seat } = await sealOwner('own-o4', 'room-o4');
  const r = await waitingRun(seat, 'room-o4', 'mac-w4');
  await r.reveal();
  await fedseats.allowOwn('own-o4', r.w.pub, r.code());
  // Move the room to epoch 1 as a revoke would, then reconnect: sendRotates runs on connect.
  const st = fedseal.roomState('own-o4');
  const next = fedseal.randomSecret();
  fedseal.setRoomState('own-o4', Object.assign({}, st, { epoch: 1, keys: Object.assign({}, st.keys, { 1: next }), rotatedAt: Date.now() }));
  say(seat, { event: 'connected', room: 'room-o4', expires_at: 9 });
  await settle();
  const rot = sent(seat, 'key-rotate');
  assert.strictEqual(rot.length, 1, 'one rotate, to the own computer');
  assert.strictEqual(fedseal.openRotate(r.w, fedseal.sealingKey().pub, rot[0], 'room-o4').roomKey, next);
});

test('#4658: a board without the room\'s key (an unsealed room) answers no hello and keeps no list', async () => {
  federation.recordLink('own-o5', { role: 'owner', ref: 'ref-own-o5', selfShared: true });
  const h = harness({ edges: [{ id: 'edge-o5', project_ref: 'ref-own-o5', status: 'active' }] });
  await fedseats.ensure('own-o5');
  say(h.spawned[0], { event: 'connected', room: 'room-o5', expires_at: 9 });
  await settle();
  say(h.spawned[0], { event: 'message', data: fedseal.ownHelloFrame(fedseal.newKeyPair(), 'mac-x', fedseal.randomSecret()) });
  await settle();
  assert.deepStrictEqual(sent(h.spawned[0], 'key-own-offer'), []);
  assert.deepStrictEqual(fedseats.ownWaiting('own-o5'), []);
  assert.strictEqual((await fedseats.allowOwn('own-o5', 'nope', 'AAAAA-AAAAA')).ok, false);
});

test('#4658: the waiting list is bounded, oldest out first', async () => {
  const { seat } = await sealOwner('own-o6', 'room-o6');
  const keys = [];
  for (let i = 0; i < 20; i++) {
    const k = fedseal.newKeyPair();
    const nW = fedseal.randomSecret();
    keys.push(k.pub);
    say(seat, { event: 'message', data: fedseal.ownHelloFrame(k, 'mac-' + i, nW) });
    await settle();
    say(seat, { event: 'message', data: fedseal.ownRevealFrame('mac-' + i, fedseal.sealingKey().pub, nW) });
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
/** Make an own computer see its room sealed, and return its hello. */
async function sealedNow(seat, room, roomKey = fedseal.randomSecret()) {
  say(seat, { event: 'message', data: fedseal.seal(roomKey, 0, room, { from: 'Ada', kind: 'person', text: 'sealed' }) });
  await settle();
  return fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
}
/** The seal owner, played by hand: offer for the hello, and (later) a share bound to the run. */
function handOwner(room, hello) {
  const owner = fedseal.newKeyPair();
  const nO = fedseal.randomSecret();
  return {
    owner, nO,
    offer: fedseal.ownOfferFrame(owner, hello, nO),
    share: (nW, roomKey) => fedseal.ownShareFrame(owner, { mac: hello.mac, pub: hello.pub, nW, nO }, fedseal.compareCode(room, hello.mac, hello.pub, owner.pub, nW, nO), roomKey, 0, room),
  };
}
const revealOf = (seat) => sent(seat, 'key-own-reveal').pop();

test('#4658: an own computer that sees its room sealed holds its posts and says hello with a commitment', async () => {
  const { h, seat } = await ownComputer('own-s1', 'room-s1');
  assert.strictEqual(fedseats.post('own-s1', { from: 'Josh', kind: 'person', text: 'before' }), true, 'before the seal: in the clear, as today');
  await settle();
  const hello = await sealedNow(seat, 'room-s1');
  const st = fedseal.roomState('own-s1');
  assert.strictEqual(st.role, 'member');
  assert.strictEqual(st.own, true);
  assert.ok(hello, 'no hello');
  assert.strictEqual(hello.mac, MY_MAC);
  assert.strictEqual(hello.pub, fedseal.sealingKey().pub);
  assert.deepStrictEqual(sent(seat, 'key-own-reveal'), [], 'revealed before any offer');
  const before = h.spawned[0].written.length;
  fedseats.post('own-s1', { from: 'Josh', kind: 'person', text: 'must not go in the clear' });
  await settle();
  assert.ok(!h.spawned[0].written.slice(before).join('').includes('must not go in the clear'), 'a post went out in the clear in a sealed room');
  assert.ok(h.notes.some((n) => n.projectId === 'own-s1' && /It matches/.test(n.text)));
});

test('#4658: the own computer adopts the share only after its person confirms, and then reads and sends sealed', async () => {
  const { h, seat } = await ownComputer('own-s2', 'room-s2');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s2', roomKey);
  fedseats.post('own-s2', { from: 'Josh', kind: 'person', text: 'held until the key' });
  await settle();
  const o = handOwner('room-s2', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const rev = revealOf(seat);
  const nW = fedseal.checkOwnReveal(rev, MY_MAC, o.owner.pub, hello.commit);
  assert.ok(nW, 'the reveal does not open the hello\'s commitment');
  const code = fedseal.compareCode('room-s2', MY_MAC, hello.pub, o.owner.pub, nW, o.nO);
  assert.strictEqual(fedseats.ownCode('own-s2'), code, 'this screen shows a different code from the owner\'s');
  // The share arrives BEFORE the person confirms: kept, not adopted.
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-s2').peer, undefined, 'adopted before its person confirmed');
  assert.strictEqual((await fedseats.confirmOwn('own-s2', 'AAAAA-AAAAA')).ok, false, 'a wrong code confirmed');
  assert.strictEqual(fedseal.roomState('own-s2').peer, undefined);
  assert.deepStrictEqual(await fedseats.confirmOwn('own-s2', code.toLowerCase()), { ok: true, because: null });
  const st = fedseal.roomState('own-s2');
  assert.strictEqual(st.peer, o.owner.pub, 'the confirmed owner key is pinned');
  assert.strictEqual(st.keys[0], roomKey);
  const sealedOut = lines(seat).filter((f) => fedseal.isSealed(f));
  assert.ok(sealedOut.some((env) => { const x = fedseal.open({ 0: roomKey }, 'room-s2', env); return x && x.m && x.m.text === 'held until the key'; }), 'the held post was not sent sealed');
  say(seat, { event: 'message', data: fedseal.seal(roomKey, 0, 'room-s2', { from: 'Ada', kind: 'person', text: 'now readable' }) });
  await settle();
  assert.ok(h.recorded.some((r) => r.text === 'now readable'));
});

test('#4658: confirming first, then the share arriving, adopts too', async () => {
  const { seat } = await ownComputer('own-s2b', 'room-s2b');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s2b', roomKey);
  const o = handOwner('room-s2b', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit);
  assert.strictEqual((await fedseats.confirmOwn('own-s2b', fedseats.ownCode('own-s2b'))).ok, true);
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-s2b').keys[0], roomKey);
});

test('#4658: the coordinator-picks-the-key attack: a share from any key but the confirmed owner\'s is never adopted', async () => {
  const { h, seat } = await ownComputer('own-s3', 'room-s3');
  const hello = await sealedNow(seat, 'room-s3');
  fedseats.post('own-s3', { from: 'Josh', kind: 'person', text: 'private words' });
  await settle();
  const real = handOwner('room-s3', hello);
  say(seat, { event: 'message', data: real.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, real.owner.pub, hello.commit);
  await fedseats.confirmOwn('own-s3', fedseats.ownCode('own-s3'));
  // The attacker knows every public value, including nW now, and seals a key of its choosing.
  const attacker = fedseal.newKeyPair();
  const chosen = fedseal.randomSecret();
  const forged = fedseal.ownShareFrame(attacker, { mac: MY_MAC, pub: hello.pub, nW, nO: real.nO },
    fedseal.compareCode('room-s3', MY_MAC, hello.pub, attacker.pub, nW, real.nO), chosen, 0, 'room-s3');
  say(seat, { event: 'message', data: forged });
  say(seat, { event: 'message', data: Object.assign({}, forged, { owner: real.owner.pub }) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-s3').peer, undefined, 'adopted a share nobody confirmed');
  const out = lines(seat).filter((f) => fedseal.isSealed(f));
  assert.ok(!out.some((env) => fedseal.open({ 0: chosen }, 'room-s3', env)), 'a held post went out under the attacker\'s key');
  assert.ok(!h.spawned[0].written.join('').includes('private words'), 'a held post went out in the clear');
});

test('#4658: a second offer for the same commitment is ignored, so the nonce is revealed once', async () => {
  const { seat } = await ownComputer('own-s4', 'room-s4');
  const hello = await sealedNow(seat, 'room-s4');
  const first = handOwner('room-s4', hello);
  const second = handOwner('room-s4', hello);
  say(seat, { event: 'message', data: first.offer });
  say(seat, { event: 'message', data: second.offer });
  await settle();
  const reveals = sent(seat, 'key-own-reveal');
  assert.strictEqual(reveals.length, 1, 'the nonce was revealed to two offers');
  assert.strictEqual(reveals[0].owner, first.owner.pub);
});

test('#4658: "does not match" starts a new run with a new commitment and a new code', async () => {
  const { seat } = await ownComputer('own-s5', 'room-s5');
  const hello = await sealedNow(seat, 'room-s5');
  say(seat, { event: 'message', data: handOwner('room-s5', hello).offer });
  await settle();
  const code = fedseats.ownCode('own-s5');
  assert.ok(code);
  assert.strictEqual(fedseats.ownStartOver('own-s5'), true);
  const again = fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
  assert.notStrictEqual(again.commit, hello.commit, 'the same nonce was used for a new run');
  assert.strictEqual(fedseats.ownCode('own-s5'), null, 'the old code is still shown');
  assert.strictEqual((await fedseats.confirmOwn('own-s5', code)).ok, false, 'the old run can still be confirmed');
});

test('#4658: an own computer accepts a rotation from the owner it pinned, and not from any other key', async () => {
  const { seat } = await ownComputer('own-s6', 'room-s6');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s6', roomKey);
  const o = handOwner('room-s6', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit);
  await fedseats.confirmOwn('own-s6', fedseats.ownCode('own-s6'));
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  const me = fedseal.sealingKey();
  say(seat, { event: 'message', data: fedseal.rotateFrame(fedseal.newKeyPair(), me.pub, fedseal.randomSecret(), 1, 'room-s6', Date.now()) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-s6').epoch, 0, 'a rotation from an unpinned key was taken');
  const next = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(o.owner, me.pub, next, 1, 'room-s6', Date.now()) });
  await settle();
  const st = fedseal.roomState('own-s6');
  assert.strictEqual(st.epoch, 1);
  assert.strictEqual(st.keys[1], next);
});

test('#4658: an own computer with no id (macId not wired, or throwing) records the seal but says no hello', async () => {
  for (const [id, macId] of [['own-s7', () => null], ['own-s7b', () => { throw new Error('no id'); }]]) {
    const { seat } = await ownComputer(id, 'room-' + id, { macId });
    say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-' + id, { from: 'Ada', kind: 'person', text: 'x' }) });
    await settle();
    assert.strictEqual(fedseal.roomState(id).own, true, 'still holds its posts');
    assert.deepStrictEqual(sent(seat, 'key-own-hello'), []);
  }
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
  assert.deepStrictEqual(sent(h.spawned[0], 'key-own-hello'), []);
});

test('#4658: a forged share relabelled with the owner\'s key cannot displace a genuine one waiting for the confirm', async () => {
  const { seat } = await ownComputer('own-s8', 'room-s8');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s8', roomKey);
  const o = handOwner('room-s8', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit);
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  const attacker = fedseal.newKeyPair();
  const forged = fedseal.ownShareFrame(attacker, { mac: MY_MAC, pub: hello.pub, nW, nO: o.nO },
    fedseal.compareCode('room-s8', MY_MAC, hello.pub, attacker.pub, nW, o.nO), fedseal.randomSecret(), 0, 'room-s8');
  say(seat, { event: 'message', data: Object.assign({}, forged, { owner: o.owner.pub }) });
  await settle();
  assert.strictEqual((await fedseats.confirmOwn('own-s8', fedseats.ownCode('own-s8'))).ok, true);
  assert.strictEqual(fedseal.roomState('own-s8').keys[0], roomKey, 'the genuine share was displaced');
});
