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
// The relay stamps a frame from this account's own computers with same_account (kosmos#4657); own frames carry it here
// unless a test says otherwise (sayAs).
const say = (child, obj) => child.stdout.write(JSON.stringify(
  obj && obj.data && typeof obj.data.t === 'string' && obj.data.t.startsWith('key-own-') && obj.same_account === undefined ? Object.assign({ same_account: true }, obj) : obj) + '\n');
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
  const offer = fedseal.checkOwnOffer(offerFrame, mac, commit, w.pub);
  return {
    w, nW, commit, offer, mac,
    reveal: async () => { say(seat, { event: 'message', data: fedseal.ownRevealFrame(mac, offer.ownerPub, nW, w.pub) }); await settle(); },
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
  say(seat, { event: 'message', data: fedseal.ownRevealFrame(r.mac, r.offer.ownerPub, fedseal.randomSecret(), r.w.pub) });
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
  const offer = fedseal.checkOwnOffer(sent(seat, 'key-own-offer').pop(), 'mac-new', fedseal.ownCommit(nW), r.w.pub);
  assert.ok(offer, 'a pinned key under a new id was ignored');
  assert.strictEqual(sent(seat, 'key-own-share').length, 1, 'a key was re-sent without a new Allow');
  say(seat, { event: 'message', data: fedseal.ownRevealFrame('mac-new', offer.ownerPub, nW, r.w.pub) });
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

test('#4658 slice 2: the owner of an UNSEALED own room answers a hello, lists the computer, and Allow sends a clear that pins nothing', async () => {
  federation.recordLink('own-o5', { role: 'owner', ref: 'ref-own-o5', selfShared: true });
  const h = harness({ edges: [{ id: 'edge-o5', project_ref: 'ref-own-o5', status: 'active' }] });
  await fedseats.ensure('own-o5');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-o5', expires_at: 9 });
  await settle();
  const run = await waitingRun(seat, 'room-o5');
  assert.ok(run.offer, 'an unsealed owner answered no hello');
  await run.reveal();
  assert.deepStrictEqual(fedseats.ownWaiting('own-o5').map((w) => w.pub), [run.w.pub], 'listed once its reveal opens');
  assert.strictEqual((await fedseats.allowOwn('own-o5', run.w.pub, 'AAAAA-AAAAA')).ok, false, 'a wrong code lets nobody in');
  assert.deepStrictEqual(sent(seat, 'key-own-clear'), []);
  assert.deepStrictEqual(await fedseats.allowOwn('own-o5', run.w.pub, run.code()), { ok: true, because: null });
  const clear = sent(seat, 'key-own-clear').pop();
  assert.ok(fedseal.openOwnClear(run.w, run.mac, run.offer.ownerPub, run.nW, run.offer.nO, clear, 'room-o5'), 'the clear does not open for that computer');
  assert.deepStrictEqual(sent(seat, 'key-own-share'), [], 'an unsealed room sends no key');
  assert.strictEqual(fedseal.roomState('own-o5'), null, 'nothing is pinned for an unsealed room');
  // The same computer's hello repeats (every pass) until its person confirms: it gets the same clear, and no new run.
  const offersBefore = sent(seat, 'key-own-offer').length;
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(run.w, run.mac, run.nW) });
  await settle();
  assert.strictEqual(sent(seat, 'key-own-offer').length, offersBefore, 'a repeated hello after Allow started a new run');
  assert.deepStrictEqual(sent(seat, 'key-own-clear').pop(), clear, 'the repeated hello did not get the same clear');
  assert.deepStrictEqual(fedseats.ownWaiting('own-o5'), [], 'listed again after Allow');
  // The room is sealed since (a sealing invite): the same repeated hello gets no clear any more (review 7).
  fedseal.stashInvite('ref-own-o5', { s: 'D'.repeat(43), code: 'CODE5', invite: 'inv-5' });
  fedseal.setRoomState('own-o5', { role: 'owner', peers: {}, epoch: 0, keys: { 0: fedseal.randomSecret() } });   // a guest joined: keyed
  const clearsBefore = sent(seat, 'key-own-clear').length;
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(run.w, run.mac, run.nW) });
  await settle();
  assert.strictEqual(sent(seat, 'key-own-clear').length, clearsBefore, 'a room sealed since still resent its clear');
});

test('#4658 slice 2 CONTROL: an owner whose room is sealed but holds no key yet still answers no hello', async () => {
  federation.recordLink('own-o6', { role: 'owner', ref: 'ref-own-o6', selfShared: true, sealed: true });
  const h = harness({ edges: [{ id: 'edge-o6', project_ref: 'ref-own-o6', status: 'active' }] });
  await fedseats.ensure('own-o6');
  say(h.spawned[0], { event: 'connected', room: 'room-o6', expires_at: 9 });
  await settle();
  say(h.spawned[0], { event: 'message', data: fedseal.ownHelloFrame(fedseal.newKeyPair(), 'mac-x', fedseal.randomSecret()) });
  await settle();
  assert.deepStrictEqual(sent(h.spawned[0], 'key-own-offer'), [], 'a sealed room must never answer with a clear path');
  assert.deepStrictEqual(fedseats.ownWaiting('own-o6'), []);
});

/** A computer that joined by an unsealed room's code (version 3), seat connected: what the join writes. */
async function pendingComputer(id, room) {
  federation.recordLink(id, { role: 'self', ref: 'ref-' + id, pendingClear: true });
  fedseal.setRoomState(id, { role: 'member', ownComputer: true, pendingClear: true, keys: {} });
  const h = harness();
  await fedseats.ensure(id);
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room, expires_at: 9 });
  await settle();
  return { h, seat, hello: fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop()) };
}

test('#4658 slice 2: a computer waiting to be let into an unsealed room holds its posts, shows the room, and posts in the clear only after confirm and a genuine clear', async () => {
  const { h, seat, hello } = await pendingComputer('own-c1', 'room-c1');
  assert.ok(hello, 'no hello from a waiting computer');
  fedseats.post('own-c1', { from: 'Josh', kind: 'person', text: 'waiting words' });
  await settle();
  assert.ok(!seat.written.join('').includes('waiting words'), 'a post left before the owner answered');
  // The room's unsealed messages are shown meanwhile: it is not known to be sealed.
  say(seat, { event: 'message', data: { from: 'Ada', kind: 'person', text: 'plain hello' } });
  await settle();
  assert.ok(h.recorded.some((r) => r.text === 'plain hello'), 'an unsealed message was refused while waiting');
  const o = handOwner('room-c1', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  // A clear from any other key is never taken, even one bound to this very run's nonces (only the owner key differs).
  const other = fedseal.newKeyPair();
  const forged = fedseal.ownClearFrame(other, { mac: hello.mac, pub: hello.pub, nW, nO: o.nO },
    fedseal.compareCode('room-c1', hello.mac, hello.pub, other.pub, nW, o.nO), 'room-c1');
  say(seat, { event: 'message', data: forged });
  await settle();
  const code = fedseal.compareCode('room-c1', MY_MAC, hello.pub, o.owner.pub, nW, o.nO);
  assert.deepStrictEqual(await fedseats.confirmOwn('own-c1', code), { ok: true, because: null });
  assert.ok(!seat.written.join('').includes('waiting words'), 'a clear from a key nobody confirmed let the posts go');
  say(seat, { event: 'message', data: o.clear(nW) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-c1'), null, 'the waiting record stayed');
  assert.strictEqual(federation.linkFor('own-c1').pendingClear, false);
  assert.ok(seat.written.join('').includes('waiting words'), 'the held post did not go once let in');
  // Let in by the owner's word: an unopenable envelope afterwards changes nothing (review 4).
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-c1', { from: 'Mallory', kind: 'person', text: 'x' }) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-c1'), null, 'a forged envelope put a let-in computer back into waiting');
  fedseats.post('own-c1', { from: 'Josh', kind: 'person', text: 'after let in' });
  await settle();
  assert.ok(seat.written.join('').includes('after let in'), 'posts held again after a forged envelope');
});

test('#4658 slice 2: a computer with no seal record that sees an unopenable envelope waits for the owner\'s answer (pendingClear), and the owner\'s clear lets it go', async () => {
  const { seat } = await ownComputer('own-old1', 'room-old1');
  const hello = await sealedNow(seat, 'room-old1');
  assert.deepStrictEqual(fedseal.roomState('own-old1'), { role: 'member', ownComputer: true, pendingClear: true, keys: {} }, 'an unauthenticated envelope made it sealed for good');
  assert.strictEqual(federation.linkFor('own-old1').sealed, undefined, 'an unauthenticated envelope wrote a lasting seal on the link');
  fedseats.post('own-old1', { from: 'Josh', kind: 'person', text: 'old held words' });
  await settle();
  const o = handOwner('room-old1', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  await fedseats.confirmOwn('own-old1', fedseal.compareCode('room-old1', MY_MAC, hello.pub, o.owner.pub, nW, o.nO));
  say(seat, { event: 'message', data: o.clear(nW) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-old1'), null, 'the owner\'s clear did not let it go');
  assert.ok(seat.written.join('').includes('old held words'));
});

test('#4658 slice 2: a keyless record an older Kosmos wrote (no pendingClear) takes the owner\'s clear; a sealed-joined computer is told why it does not', async () => {
  federation.recordLink('own-pre1', { role: 'self', ref: 'ref-own-pre1' });
  fedseal.setRoomState('own-pre1', { role: 'member', ownComputer: true, keys: {} });
  const h = harness();
  await fedseats.ensure('own-pre1');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-pre1', expires_at: 9 });
  await settle();
  assert.strictEqual(fedseal.roomState('own-pre1').pendingClear, true, 'an older keyless record was not read as waiting (review 9)');
  const hello = fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
  const o = handOwner('room-pre1', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  await fedseats.confirmOwn('own-pre1', fedseal.compareCode('room-pre1', MY_MAC, hello.pub, o.owner.pub, nW, o.nO));
  say(seat, { event: 'message', data: o.clear(nW) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-pre1'), null, 'an older keyless record could never be let in by a clear');
  // CONTROL: a computer whose link says it joined a sealed room never takes a clear, and is told why.
  federation.recordLink('own-pre2', { role: 'self', ref: 'ref-own-pre2', sealed: true });
  fedseal.setRoomState('own-pre2', { role: 'member', ownComputer: true, keys: {} });
  const h2 = harness();
  await fedseats.ensure('own-pre2');
  const seat2 = h2.spawned[0];
  say(seat2, { event: 'connected', room: 'room-pre2', expires_at: 9 });
  await settle();
  const hello2 = fedseal.checkOwnHello(sent(seat2, 'key-own-hello').pop());
  const o2 = handOwner('room-pre2', hello2);
  say(seat2, { event: 'message', data: o2.offer });
  await settle();
  const nW2 = fedseal.checkOwnReveal(revealOf(seat2), MY_MAC, o2.owner.pub, hello2.commit, hello2.pub);
  await fedseats.confirmOwn('own-pre2', fedseal.compareCode('room-pre2', MY_MAC, hello2.pub, o2.owner.pub, nW2, o2.nO));
  say(seat2, { event: 'message', data: o2.clear(nW2) });
  await settle();
  assert.deepStrictEqual(fedseal.roomState('own-pre2'), { role: 'member', ownComputer: true, keys: {} }, 'a sealed-joined computer took a clear');
  assert.ok(h2.notes.some((n) => n.projectId === 'own-pre2' && /joined it with a code for a sealed room, so it does not trust that/.test(n.text)), 'refused with no word why');
});

test('#4658 slice 2: a clear that arrives BEFORE the person confirms is kept, and the confirm lets the posts go', async () => {
  const { seat, hello } = await pendingComputer('own-c3', 'room-c3');
  fedseats.post('own-c3', { from: 'Josh', kind: 'person', text: 'early clear words' });
  await settle();
  const o = handOwner('room-c3', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  say(seat, { event: 'message', data: o.clear(nW) });
  await settle();
  assert.ok(!seat.written.join('').includes('early clear words'), 'let in before its person confirmed');
  // The owner dropped this computer from its list at Allow, so its next hello (every pass) gets a NEW offer: the run
  // holding the genuine clear must keep it (review 3).
  const o2 = fedseal.ownOfferFrame(o.owner, hello, fedseal.randomSecret());
  say(seat, { event: 'message', data: o2 });
  await settle();
  const code = fedseal.compareCode('room-c3', MY_MAC, hello.pub, o.owner.pub, nW, o.nO);
  assert.strictEqual(fedseats.ownCode('own-c3'), code, 'a new offer after Allow reset the run that held the clear');
  assert.deepStrictEqual(await fedseats.confirmOwn('own-c3', code), { ok: true, because: null });
  await settle();
  assert.strictEqual(fedseal.roomState('own-c3'), null);
  assert.ok(seat.written.join('').includes('early clear words'), 'the confirm did not let the held post go');
});

test('#4658 slice 2: a sealed envelope while waiting changes nothing; only the owner\'s share makes the room sealed, and then a clear is refused', async () => {
  const { h, seat, hello } = await pendingComputer('own-c2', 'room-c2');
  fedseats.post('own-c2', { from: 'Josh', kind: 'person', text: 'still private' });
  await settle();
  // Anyone in the room (the relay, a guest) can send a sealed-looking envelope: it locks nothing.
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-c2', { from: 'Mallory', kind: 'person', text: 'sealed' }) });
  await settle();
  assert.deepStrictEqual(fedseal.roomState('own-c2'), { role: 'member', ownComputer: true, pendingClear: true, keys: {} }, 'an unauthenticated envelope changed the waiting record');
  assert.strictEqual(federation.linkFor('own-c2').sealed, undefined);
  assert.ok(h.notes.some((n) => n.projectId === 'own-c2' && /cannot read yet/.test(n.text)), 'the person is not told why');
  // The owner's room is sealed after all: its share (bound to the code the person confirms) decides.
  const o = handOwner('room-c2', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  const code = fedseal.compareCode('room-c2', MY_MAC, hello.pub, o.owner.pub, nW, o.nO);
  const roomKey = fedseal.randomSecret();
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  await fedseats.confirmOwn('own-c2', code);
  await settle();
  const st = fedseal.roomState('own-c2');
  assert.deepStrictEqual([st.pendingClear, st.keys[0]], [undefined, roomKey], 'the share did not end the wait');
  assert.deepStrictEqual([federation.linkFor('own-c2').sealed, federation.linkFor('own-c2').pendingClear], [true, false], 'the link still says waiting');
  assert.strictEqual(federation.ownCodeRefusal('own-c2'), null, 'let in by a share, it can hand codes on');
  assert.ok(!seat.written.join('').includes('still private'), 'a held post went out in the clear in a sealed room');
  assert.ok(lines(seat).filter((f) => fedseal.isSealed(f)).some((env) => { const x = fedseal.open({ 0: roomKey }, 'room-c2', env); return x && x.m && x.m.text === 'still private'; }), 'the held post was not sent sealed');
  // A clear afterwards (replayed, or from the same owner) changes nothing.
  say(seat, { event: 'message', data: o.clear(nW) });
  await settle();
  assert.strictEqual(fedseal.roomState('own-c2').keys[0], roomKey);
});

test('#4658 slice 2: a clear whose link cannot be written leaves the computer waiting (record kept, posts held), never half let in', async () => {
  const { h, seat, hello } = await pendingComputer('own-c4', 'room-c4');
  fedseats.post('own-c4', { from: 'Josh', kind: 'person', text: 'half words' });
  await settle();
  const o = handOwner('room-c4', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  const code = fedseal.compareCode('room-c4', MY_MAC, hello.pub, o.owner.pub, nW, o.nO);
  await fedseats.confirmOwn('own-c4', code);
  const real = federation.recordLink;
  federation.recordLink = () => { throw new Error('EACCES'); };
  try {
    say(seat, { event: 'message', data: o.clear(nW) });
    await settle();
  } finally { federation.recordLink = real; }
  assert.deepStrictEqual(fedseal.roomState('own-c4'), { role: 'member', ownComputer: true, pendingClear: true, keys: {} }, 'the record went with the link unwritten');
  assert.ok(!seat.written.join('').includes('half words'));
  assert.ok(!h.notes.some((n) => n.projectId === 'own-c4' && /was let into/.test(n.text)), 'said let in before both writes');
  // The next connect takes the kept clear again, now that the link can be written.
  say(seat, { event: 'connected', room: 'room-c4', expires_at: 9 });
  await settle();
  assert.strictEqual(fedseal.roomState('own-c4'), null, 'the kept clear was not taken on the next connect');
  assert.ok(seat.written.join('').includes('half words'));
});

test('#4658: the owner starts at most OWN_RUNS_PER_HOUR new runs an hour, and keeps at most 16 waiting, oldest out first', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const { seat } = await sealOwner('own-o6', 'room-o6');
  const keys = [];
  const hello = async (i) => {
    const k = fedseal.newKeyPair();
    const nW = fedseal.randomSecret();
    keys.push(k.pub);
    say(seat, { event: 'message', data: fedseal.ownHelloFrame(k, 'mac-' + i, nW) });
    await settle();
    say(seat, { event: 'message', data: fedseal.ownRevealFrame('mac-' + i, fedseal.sealingKey().pub, nW, k.pub) });
    await settle();
  };
  for (let i = 0; i < fedseats.OWN_RUNS_PER_HOUR + 3; i++) await hello(i);
  assert.strictEqual(sent(seat, 'key-own-offer').length, fedseats.OWN_RUNS_PER_HOUR, 'more new runs than the hourly limit');
  assert.strictEqual(fedseats.ownWaiting('own-o6').length, fedseats.OWN_RUNS_PER_HOUR);
  t.mock.timers.tick(61 * 60 * 1000);
  for (let i = 100; i < 108; i++) await hello(i);
  const list = fedseats.ownWaiting('own-o6');
  assert.strictEqual(list.length, 16, 'the waiting list is not bounded');
  const answered = keys.slice(0, fedseats.OWN_RUNS_PER_HOUR).concat(keys.slice(fedseats.OWN_RUNS_PER_HOUR + 3));
  assert.deepStrictEqual(list.map((x) => x.pub), answered.slice(-16), 'not oldest out first');
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
    clear: (nW) => fedseal.ownClearFrame(owner, { mac: hello.mac, pub: hello.pub, nW, nO }, fedseal.compareCode(room, hello.mac, hello.pub, owner.pub, nW, nO), room),
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
  assert.strictEqual(st.ownComputer, true);
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

test('#4658: a computer joined by a sealed (version 2) code holds its FIRST post and says hello on connect, with no sealed frame seen', async () => {
  // What the join writes for a version 2 code, before the seat starts (server.js own join).
  federation.recordLink('own-j1', { role: 'self', ref: 'ref-own-j1' });
  fedseal.setRoomState('own-j1', { role: 'member', ownComputer: true, keys: {} });
  const h = harness();
  await fedseats.ensure('own-j1');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-j1', expires_at: 9 });
  await settle();
  const hello = fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
  assert.ok(hello, 'no hello on connect');
  assert.strictEqual(hello.mac, MY_MAC);
  fedseats.post('own-j1', { from: 'Josh', kind: 'person', text: 'first words here' });
  await settle();
  assert.ok(!seat.written.join('').includes('first words here'), 'the first post went out in the clear');
});

test('#4658: a computer that joined by a sealed code and lost its seal record still holds its posts (the link remembers)', async () => {
  federation.recordLink('own-j3', { role: 'self', ref: 'ref-own-j3', sealed: true });
  const h = harness();
  await fedseats.ensure('own-j3');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-j3', expires_at: 9 });
  await settle();
  fedseats.post('own-j3', { from: 'Josh', kind: 'person', text: 'no record words' });
  await settle();
  assert.ok(!seat.written.join('').includes('no record words'), 'a post went out in the clear after the seal record was lost');
  // And it asks for the key again: the record is written back from the link and a hello goes out.
  assert.deepEqual(fedseal.roomState('own-j3'), { role: 'member', ownComputer: true, keys: {} });
  assert.ok(fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop()), 'no hello: it would hold its posts with nothing asked');
});

test('#4658: a sealed own computer whose record cannot be written back still holds its posts, and says why', async () => {
  federation.recordLink('own-j4', { role: 'self', ref: 'ref-own-j4', sealed: true });
  const real = fedseal.setRoomState;
  fedseal.setRoomState = () => { throw new Error('EACCES'); };
  try {
    const h = harness();
    await fedseats.ensure('own-j4');
    const seat = h.spawned[0];
    say(seat, { event: 'connected', room: 'room-j4', expires_at: 9 });
    await settle();
    assert.strictEqual(fedseal.roomState('own-j4'), null, 'precondition: the record really was not written back');
    fedseats.post('own-j4', { from: 'Josh', kind: 'person', text: 'unwritable words' });
    await settle();
    assert.ok(!seat.written.join('').includes('unwritable words'), 'the link alone must hold the post (isSealedRoom self clause)');
    assert.ok(h.notes.some((n) => n.projectId === 'own-j4' && /could not record that/.test(n.text)), 'held with no word why');
  } finally { fedseal.setRoomState = real; }
});

test('#4658: an owner room whose link says sealed reads as sealed with no seal file (no owner post in the clear)', () => {
  assert.strictEqual(fedseats.isSealedRoom(null, { role: 'owner', ref: 'ref-none-1', sealedOwn: true }), true);
  assert.strictEqual(fedseats.isSealedRoom(null, { role: 'owner', ref: 'ref-none-2', sealed: true }), true);
  // CONTROL: the same owner with neither mark and no seal file is unsealed, as main reads it.
  assert.strictEqual(fedseats.isSealedRoom(null, { role: 'owner', ref: 'ref-none-3' }), false);
});

test('#4658 CONTROL: the same computer joined by a version 1 code (no record) sends its first post in the clear, as main does', async () => {
  federation.recordLink('own-j2', { role: 'self', ref: 'ref-own-j2' });
  const h = harness();
  await fedseats.ensure('own-j2');
  const seat = h.spawned[0];
  say(seat, { event: 'connected', room: 'room-j2', expires_at: 9 });
  await settle();
  fedseats.post('own-j2', { from: 'Josh', kind: 'person', text: 'plain words here' });
  await settle();
  assert.ok(seat.written.join('').includes('plain words here'), 'the control did not send: the test above would pass for the wrong reason');
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
  const nW = fedseal.checkOwnReveal(rev, MY_MAC, o.owner.pub, hello.commit, hello.pub);
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
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
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
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, real.owner.pub, hello.commit, hello.pub);
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

test('#4658: a second offer for the same commitment gets no reveal of the nonce (it is revealed once)', async () => {
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
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
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
    assert.strictEqual(fedseal.roomState(id).ownComputer, true, 'still holds its posts');
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
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
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

/* ---- iteration-2 review: who may take part, and the exchange recovering ---- */

test('#4658: own frames without the relay\'s same-account stamp are ignored on both sides (a guest cannot take part)', async () => {
  const { seat } = await sealOwner('own-o7', 'room-o7');
  const w = fedseal.newKeyPair();
  say(seat, { event: 'message', same_account: false, data: fedseal.ownHelloFrame(w, 'mac-g', fedseal.randomSecret()) });
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(w, 'mac-g', fedseal.randomSecret()), same_account: null });
  await settle();
  assert.deepStrictEqual(sent(seat, 'key-own-offer'), [], 'a hello with no same-account stamp was answered');
  const { seat: s2 } = await ownComputer('own-s9', 'room-s9');
  const hello = await sealedNow(s2, 'room-s9');
  say(s2, { event: 'message', same_account: false, data: handOwner('room-s9', hello).offer });
  await settle();
  assert.deepStrictEqual(sent(s2, 'key-own-reveal'), [], 'an offer with no same-account stamp was answered');
});

test('#4658: a key already pinned as a guest is never listed as an own computer', async () => {
  const { seat } = await sealOwner('own-o8', 'room-o8');
  const guest = fedseal.newKeyPair();
  const st = fedseal.roomState('own-o8');
  fedseal.setRoomState('own-o8', Object.assign({}, st, { peers: { [guest.pub]: { edge: 'edge-g', invite: 'inv-g' } } }));
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(guest, 'mac-g', fedseal.randomSecret()) });
  await settle();
  assert.deepStrictEqual(sent(seat, 'key-own-offer'), []);
});

test('#4658: Allow pins nothing and keeps the computer waiting when the key cannot be sent', async () => {
  const { seat } = await sealOwner('own-o9', 'room-o9');
  const r = await waitingRun(seat, 'room-o9', 'mac-w9');
  await r.reveal();
  seat.stdin.write = () => { throw new Error('pipe closed'); };   // the connector went away
  const out = await fedseats.allowOwn('own-o9', r.w.pub, r.code());
  assert.strictEqual(out.ok, false, 'reported allowed with no key sent');
  assert.strictEqual(fedseal.roomState('own-o9').own, undefined, 'pinned with no key sent');
  assert.strictEqual(fedseats.ownWaiting('own-o9').length, 1, 'dropped from the list with no key sent');
});

test('#4658: a reveal opens every entry with that commitment, so a copied commitment cannot take it', async () => {
  const { seat } = await sealOwner('own-o10', 'room-o10');
  const copier = fedseal.newKeyPair();
  const w = fedseal.newKeyPair();
  const nW = fedseal.randomSecret();
  const real = fedseal.ownHelloFrame(w, 'mac-c', nW);
  say(seat, { event: 'message', data: Object.assign({}, real, { pub: copier.pub }) });   // first, under another key
  say(seat, { event: 'message', data: real });
  await settle();
  say(seat, { event: 'message', data: fedseal.ownRevealFrame('mac-c', fedseal.sealingKey().pub, nW, w.pub) });
  await settle();
  assert.ok(fedseats.ownWaiting('own-o10').some((x) => x.pub === w.pub), 'the real computer never got its code');
});

test('#4658: the same offer again gets the same reveal again (a lost reveal recovers)', async () => {
  const { seat } = await ownComputer('own-s10', 'room-s10');
  const hello = await sealedNow(seat, 'room-s10');
  const o = handOwner('room-s10', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const reveals = sent(seat, 'key-own-reveal');
  assert.strictEqual(reveals.length, 2);
  assert.deepStrictEqual(reveals[0], reveals[1], 'a repeated offer got a different reveal');
});

test('#4658: a different offer after the reveal starts a new run (an owner board that restarted), never a second reveal of the nonce', async () => {
  const { seat } = await ownComputer('own-s11', 'room-s11');
  const hello = await sealedNow(seat, 'room-s11');
  const o = handOwner('room-s11', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const restarted = fedseal.ownOfferFrame(o.owner, hello, fedseal.randomSecret());   // same owner key, new nonce
  say(seat, { event: 'message', data: restarted });
  await settle();
  assert.strictEqual(sent(seat, 'key-own-reveal').length, 1, 'the nonce was revealed to a second offer');
  const again = fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
  assert.notStrictEqual(again.commit, hello.commit, 'no new run started');
});

/* ---- iteration-3 review ---- */

test('#4658: a confirmed run still waiting for its share ends when a different offer comes (the owner board restarted)', async () => {
  const { seat } = await ownComputer('own-s12', 'room-s12');
  const hello = await sealedNow(seat, 'room-s12');
  const o = handOwner('room-s12', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  assert.strictEqual((await fedseats.confirmOwn('own-s12', fedseats.ownCode('own-s12'))).ok, true);
  say(seat, { event: 'message', data: fedseal.ownOfferFrame(o.owner, hello, fedseal.randomSecret()) });
  await settle();
  const again = fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
  assert.notStrictEqual(again.commit, hello.commit, 'a confirmed run with no share never ended');
  assert.strictEqual(fedseats.ownCode('own-s12'), null, 'the new run shows a code before any offer');
  assert.strictEqual(sent(seat, 'key-own-reveal').length, 1, 'the old nonce was revealed again');
});

test('#4658: with every guest revoked, an allowed own computer keeps the old key\'s grace (its in-flight posts still open)', async () => {
  const id = 'own-o11';
  const { h, seat } = await sealOwner(id, 'room-o11');
  const r = await waitingRun(seat, 'room-o11', 'mac-w11');
  await r.reveal();
  await fedseats.allowOwn(id, r.w.pub, r.code());
  const guest = fedseal.newKeyPair();
  const st = fedseal.roomState(id);
  fedseal.setRoomState(id, Object.assign({}, st, { peers: { [guest.pub]: { edge: 'edge-gone', invite: 'inv-gone' } } }));
  const link = federation.linkFor(id);
  const rotated = await fedseats.rotateForRevoked(id, link, async () => ({ ok: true, data: { as_owner: [{ id: 'edge-gone', project_ref: link.ref, status: 'revoked' }] } }));
  assert.strictEqual(rotated, true);
  const after = fedseal.roomState(id);
  assert.strictEqual(after.epoch, 1);
  assert.strictEqual(typeof after.keys[0], 'string', 'the old key was dropped with an own computer still in the room');
  assert.deepStrictEqual(Object.keys(after.own), [r.w.pub], 'the own computer was dropped by a guest revoke');
  // A post the own computer sealed just before the rotation still opens on the owner.
  const env = fedseal.seal(st.keys[0], 0, 'room-o11', { from: 'Josh', kind: 'person', text: 'in flight' });
  say(seat, { event: 'message', data: env });
  await settle();
  // No guest is pinned now, so the owner opens it without an edge hold: recorded, not refused as retired.
  assert.ok(h.recorded.some((x) => x.text === 'in flight'), 'the own computer\'s in-flight post was refused');
});

/* ---- iteration-5 review ---- */

test('#4658: a rotation between the Allow and the confirm is applied before the held posts go', async () => {
  const { seat } = await ownComputer('own-s13', 'room-s13');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s13', roomKey);
  fedseats.post('own-s13', { from: 'Josh', kind: 'person', text: 'held across a rotation' });
  await settle();
  const o = handOwner('room-s13', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  say(seat, { event: 'message', data: o.share(nW, roomKey) });   // Allow pressed: epoch 0
  await settle();
  const next = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(o.owner, fedseal.sealingKey().pub, next, 1, 'room-s13', Date.now()) });   // a guest removed meanwhile
  await settle();
  assert.strictEqual((await fedseats.confirmOwn('own-s13', fedseats.ownCode('own-s13'))).ok, true);
  const st = fedseal.roomState('own-s13');
  assert.strictEqual(st.epoch, 1, 'the rotation that came before the confirm was dropped');
  const out = lines(seat).filter((f) => fedseal.isSealed(f));
  assert.ok(out.some((env) => { const x = fedseal.open({ 1: next }, 'room-s13', env); return x && x.m && x.m.text === 'held across a rotation'; }), 'the held post did not go under the new key');
  assert.ok(!out.some((env) => fedseal.open({ 0: roomKey }, 'room-s13', env)), 'a held post went out under the retired key');
});

/* ---- iteration-6 review ---- */

test('#4658: junk rotations cannot push out the genuine one kept for adoption', async () => {
  const { seat } = await ownComputer('own-s14', 'room-s14');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s14', roomKey);
  const o = handOwner('room-s14', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  const me = fedseal.sealingKey();
  const next = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(o.owner, me.pub, next, 1, 'room-s14', Date.now()) });
  for (let i = 0; i < 20; i++) {
    say(seat, { event: 'message', data: fedseal.rotateFrame(fedseal.newKeyPair(), me.pub, fedseal.randomSecret(), 2 + i, 'room-s14', Date.now()) });
  }
  await settle();
  assert.strictEqual((await fedseats.confirmOwn('own-s14', fedseats.ownCode('own-s14'))).ok, true);
  const st = fedseal.roomState('own-s14');
  assert.strictEqual(st.epoch, 1, 'the genuine rotation was pushed out (or a junk one was taken)');
  assert.strictEqual(st.keys[1], next);
});

/* ---- iteration-7 review ---- */

test('#4658: a waiting computer restarts its own run without its person at most OWN_RUNS_PER_HOUR times an hour', async () => {
  const { seat } = await ownComputer('own-s15', 'room-s15');
  await sealedNow(seat, 'room-s15');
  for (let i = 0; i < fedseats.OWN_RUNS_PER_HOUR + 5; i++) {
    const cur = fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
    const o = handOwner('room-s15', cur);
    say(seat, { event: 'message', data: o.offer });
    await settle();
    say(seat, { event: 'message', data: fedseal.ownOfferFrame(o.owner, cur, fedseal.randomSecret()) });   // a different offer: restart
    await settle();
  }
  // One hello for the seal, then one per restart allowed.
  assert.strictEqual(sent(seat, 'key-own-hello').length, 1 + fedseats.OWN_RUNS_PER_HOUR, 'more restarts than the hourly limit');
});

test('#4658: the owner never lists or allows its own key', async () => {
  const { seat } = await sealOwner('own-o12', 'room-o12');
  const me = fedseal.sealingKey();
  const nW = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.ownHelloFrame(me, 'mac-self', nW) });
  await settle();
  assert.deepStrictEqual(sent(seat, 'key-own-offer'), []);
  assert.strictEqual((await fedseats.allowOwn('own-o12', me.pub, 'AAAAA-AAAAA')).ok, false);
});

test('#4658: a confirmed run that starts over says so on screen', async () => {
  const { h, seat } = await ownComputer('own-s16', 'room-s16');
  const hello = await sealedNow(seat, 'room-s16');
  const o = handOwner('room-s16', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  await fedseats.confirmOwn('own-s16', fedseats.ownCode('own-s16'));
  say(seat, { event: 'message', data: fedseal.ownOfferFrame(o.owner, hello, fedseal.randomSecret()) });
  await settle();
  assert.ok(h.notes.some((n) => n.projectId === 'own-s16' && /code on this screen changed/.test(n.text)), 'the person was not told their confirm no longer counts');
});

test('#4658: an own computer with no Kosmos+ id is told why its messages wait', async () => {
  const { h, seat } = await ownComputer('own-s17', 'room-s17', { macId: () => null });
  say(seat, { event: 'message', data: fedseal.seal(fedseal.randomSecret(), 0, 'room-s17', { from: 'Ada', kind: 'person', text: 'x' }) });
  await settle();
  assert.ok(h.notes.some((n) => n.projectId === 'own-s17' && /not signed in to Kosmos\+/.test(n.text)));
  assert.ok(!h.notes.some((n) => n.projectId === 'own-s17' && /send you a new code/.test(n.text)), 'an own computer got the guest\'s advice');
});

/* ---- iteration-8 review ---- */

test('#4658: when restarts hit the hourly limit, the person is told why the code stays', async () => {
  const { h, seat } = await ownComputer('own-s18', 'room-s18');
  await sealedNow(seat, 'room-s18');
  for (let i = 0; i < fedseats.OWN_RUNS_PER_HOUR + 2; i++) {
    const cur = fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop());
    const o = handOwner('room-s18', cur);
    say(seat, { event: 'message', data: o.offer });
    await settle();
    say(seat, { event: 'message', data: fedseal.ownOfferFrame(o.owner, cur, fedseal.randomSecret()) });
    await settle();
  }
  assert.ok(h.notes.some((n) => n.projectId === 'own-s18' && /too many times this hour/.test(n.text)), 'the person was not told the code is paused');
});

test('#4658: rotations kept before adoption are bounded to the newest 8 epochs', async () => {
  const { seat } = await ownComputer('own-s19', 'room-s19');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s19', roomKey);
  const o = handOwner('room-s19', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  const me = fedseal.sealingKey();
  const keys = {};
  for (let e = 1; e <= 20; e++) {
    keys[e] = fedseal.randomSecret();
    say(seat, { event: 'message', data: fedseal.rotateFrame(o.owner, me.pub, keys[e], e, 'room-s19', Date.now()) });
  }
  await settle();
  assert.strictEqual((await fedseats.confirmOwn('own-s19', fedseats.ownCode('own-s19'))).ok, true);
  const st = fedseal.roomState('own-s19');
  assert.strictEqual(st.epoch, 20, 'the newest rotation was not applied');
  assert.strictEqual(st.keys[20], keys[20]);
  assert.strictEqual(st.keys[12], undefined, 'more than 8 epochs were kept');
  assert.strictEqual(st.keys[13], keys[13]);
});

/* ---- iteration-9 review ---- */

test('#4658: with two rotations before the confirm, no held post goes out under the middle key', async () => {
  const { seat } = await ownComputer('own-s20', 'room-s20');
  const roomKey = fedseal.randomSecret();
  const hello = await sealedNow(seat, 'room-s20', roomKey);
  fedseats.post('own-s20', { from: 'Josh', kind: 'person', text: 'held across two rotations' });
  await settle();
  const o = handOwner('room-s20', hello);
  say(seat, { event: 'message', data: o.offer });
  await settle();
  const nW = fedseal.checkOwnReveal(revealOf(seat), MY_MAC, o.owner.pub, hello.commit, hello.pub);
  say(seat, { event: 'message', data: o.share(nW, roomKey) });
  await settle();
  const me = fedseal.sealingKey();
  const k1 = fedseal.randomSecret();
  const k2 = fedseal.randomSecret();
  say(seat, { event: 'message', data: fedseal.rotateFrame(o.owner, me.pub, k1, 1, 'room-s20', Date.now()) });
  say(seat, { event: 'message', data: fedseal.rotateFrame(o.owner, me.pub, k2, 2, 'room-s20', Date.now()) });   // a guest removed at epoch 2 holds k1
  await settle();
  assert.strictEqual((await fedseats.confirmOwn('own-s20', fedseats.ownCode('own-s20'))).ok, true);
  assert.strictEqual(fedseal.roomState('own-s20').epoch, 2);
  const out = lines(seat).filter((f) => fedseal.isSealed(f));
  assert.ok(!out.some((env) => fedseal.open({ 1: k1 }, 'room-s20', env)), 'a held post went out under the middle key');
  assert.ok(out.some((env) => { const x = fedseal.open({ 2: k2 }, 'room-s20', env); return x && x.m && x.m.text === 'held across two rotations'; }), 'the held post did not go under the newest key');
});

test('#4658: an offer drawn by a copied hello (same id and commitment, another key) is not taken for this computer\'s', async () => {
  const { seat } = await ownComputer('own-s21', 'room-s21');
  const hello = await sealedNow(seat, 'room-s21');
  const copier = fedseal.newKeyPair();
  const owner = fedseal.newKeyPair();
  const copied = fedseal.ownOfferFrame(owner, Object.assign({}, hello, { pub: copier.pub }), fedseal.randomSecret());
  say(seat, { event: 'message', data: copied });   // arrives first
  await settle();
  assert.deepStrictEqual(sent(seat, 'key-own-reveal'), [], 'revealed to an offer for another key');
  const real = fedseal.ownOfferFrame(owner, hello, fedseal.randomSecret());
  say(seat, { event: 'message', data: real });
  await settle();
  const [rev] = sent(seat, 'key-own-reveal');
  assert.ok(rev, 'the real offer got no reveal');
  assert.strictEqual(rev.pub, hello.pub);
  assert.strictEqual(fedseal.checkOwnHello(sent(seat, 'key-own-hello').pop()).commit, hello.commit, 'the run was reset by the copied offer');
});
