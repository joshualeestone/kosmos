'use strict';
// kosmos#4658: the own-computer exchange in a sealed room (hello with a commitment, offer, reveal, a code both
// screens show, and the share bound to that run). The design is on the card, comment 6381388572.
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fedseal-compare-4658-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const seal = require('./fedseal');

const ROOM = 'room-abc';
const MAC = 'mac-1';
// RFC 7748 section 6.1, Alice's and Bob's public keys: fixed, valid X25519 keys for the pinned vector.
const ALICE = Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'hex').toString('base64url');
const BOB = Buffer.from('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f', 'hex').toString('base64url');
const N1 = Buffer.alloc(32, 1).toString('base64url');
const N2 = Buffer.alloc(32, 2).toString('base64url');
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;

/** One honest run between an owner and a waiting computer, as both boards would see it. */
function run() {
  const owner = seal.newKeyPair();
  const waiting = seal.newKeyPair();
  const nW = seal.randomSecret();
  const nO = seal.randomSecret();
  const hello = seal.checkOwnHello(seal.ownHelloFrame(waiting, MAC, nW));
  const offerFrame = seal.ownOfferFrame(owner, hello, nO);
  const offer = seal.checkOwnOffer(offerFrame, MAC, hello.commit);
  const revealed = seal.checkOwnReveal(seal.ownRevealFrame(MAC, offer.ownerPub, nW), MAC, owner.pub, hello.commit);
  const ownerSide = { mac: hello.mac, pub: hello.pub, nW: revealed, nO };
  const roomKey = seal.randomSecret();
  const code = seal.compareCode(ROOM, MAC, waiting.pub, owner.pub, nW, nO);
  return { owner, waiting, nW, nO, hello, offer, ownerSide, roomKey, code };
}

/* ---- the code ---- */

test('#4658: the code matches a vector computed outside this module, and so does the commitment', () => {
  // Computed with Python's hashlib over the same JSON arrays, not with this code.
  assert.strictEqual(seal.compareCode(ROOM, MAC, ALICE, BOB, N1, N2), '7FHCP-6MXV8');
  assert.strictEqual(seal.ownCommit(N1), '_fhLCGVP8_67Pbz5Rhj0tsf16aqkOESw2M_069t5OtY');
});

test('#4658: every input changes the code: room, computer, both keys, both nonces', () => {
  const base = seal.compareCode(ROOM, MAC, ALICE, BOB, N1, N2);
  assert.match(base, CODE_RE);
  const other = seal.newKeyPair().pub;
  const N3 = Buffer.alloc(32, 3).toString('base64url');
  for (const [why, c] of [
    ['room', seal.compareCode('room-abd', MAC, ALICE, BOB, N1, N2)],
    ['computer', seal.compareCode(ROOM, 'mac-2', ALICE, BOB, N1, N2)],
    ['waiting key', seal.compareCode(ROOM, MAC, other, BOB, N1, N2)],
    ['owner key', seal.compareCode(ROOM, MAC, ALICE, other, N1, N2)],
    ['waiting nonce', seal.compareCode(ROOM, MAC, ALICE, BOB, N3, N2)],
    ['owner nonce', seal.compareCode(ROOM, MAC, ALICE, BOB, N1, N3)],
    ['keys swapped', seal.compareCode(ROOM, MAC, BOB, ALICE, N1, N2)],
  ]) assert.notStrictEqual(c, base, why + ' is not bound');
});

test('#4658: the code spreads over the alphabet (no stuck position)', () => {
  const seen = Array.from({ length: 10 }, () => new Set());
  const codes = new Set();
  for (let i = 0; i < 400; i++) {
    const c = seal.compareCode(ROOM, MAC, ALICE, BOB, seal.randomSecret(), N2).replace('-', '');
    codes.add(c);
    for (let j = 0; j < 10; j++) seen[j].add(c[j]);
  }
  assert.strictEqual(codes.size, 400, 'no two nonces gave the same code');
  // 400 draws over 31 symbols leave a given symbol unseen with chance about 2e-6 per position.
  for (let j = 0; j < 10; j++) assert.strictEqual(seen[j].size, 31, `position ${j} saw ${seen[j].size} of 31 symbols`);
});

test('#4658: a malformed input gives no code and no commitment', () => {
  const ok = [ROOM, MAC, ALICE, BOB, N1, N2];
  const notString = ['', 7, null, undefined];
  const bad = notString.concat(['not-a-key', ALICE.slice(0, -2)]);   // for the keys and nonces; any string is an id
  for (let i = 0; i < ok.length; i++) {
    for (const b of i < 2 ? notString : bad) {
      const args = ok.slice();
      args[i] = b;
      assert.strictEqual(seal.compareCode(...args), null, `argument ${i} = ${JSON.stringify(b)}`);
    }
  }
  for (const b of bad) assert.strictEqual(seal.ownCommit(b), null);
});

test('#4658: the confirmed code is compared without case, spaces or the dash, and never as empty', () => {
  const c = seal.compareCode(ROOM, MAC, ALICE, BOB, N1, N2);
  assert.ok(seal.sameCompareCode(' ' + c.toLowerCase().replace('-', ' ') + ' ', c));
  assert.strictEqual(seal.sameCompareCode(c, c.replace(/.$/, (x) => (x === '2' ? '3' : '2'))), false);
  assert.strictEqual(seal.sameCompareCode('', ''), false);
  assert.strictEqual(seal.sameCompareCode(' - ', '-'), false);
  assert.strictEqual(seal.sameCompareCode(undefined, c), false);
});

/* ---- the exchange ---- */

test('#4658: an honest run: both sides compute the same code, the share opens with the confirmed owner key', () => {
  const r = run();
  assert.strictEqual(r.ownerSide.nW, r.nW, 'the owner learned the waiting nonce from the reveal');
  assert.strictEqual(seal.compareCode(ROOM, r.ownerSide.mac, r.ownerSide.pub, r.owner.pub, r.ownerSide.nW, r.ownerSide.nO), r.code, 'the two screens agree');
  const share = seal.ownShareFrame(r.owner, r.ownerSide, r.code, r.roomKey, 2, ROOM);
  assert.strictEqual(share.t, 'key-own-share', 'a key- frame, so fedseats routes it to the sealing handler');
  assert.deepStrictEqual(seal.openOwnShare(r.waiting, MAC, r.owner.pub, r.nW, r.nO, share, ROOM), { ownerPub: r.owner.pub, epoch: 2, roomKey: r.roomKey });
});

test('#4658: a share forged by any key other than the confirmed owner is refused (the coordinator-picks-the-key attack)', () => {
  const r = run();
  const attacker = seal.newKeyPair();
  // The attacker plays owner toward the waiting computer with its own key and nonce. Even holding every public
  // value, the share it can make names its own key, which is not the one the waiting person confirmed.
  const forged = seal.ownShareFrame(attacker, { mac: MAC, pub: r.waiting.pub, nW: r.nW, nO: r.nO },
    seal.compareCode(ROOM, MAC, r.waiting.pub, attacker.pub, r.nW, r.nO), seal.randomSecret(), 0, ROOM);
  assert.strictEqual(seal.openOwnShare(r.waiting, MAC, r.owner.pub, r.nW, r.nO, forged, ROOM), null, 'adopted a share from a key nobody confirmed');
  // Relabelling the frame's owner field does not help: the pair key is the attacker's.
  assert.strictEqual(seal.openOwnShare(r.waiting, MAC, r.owner.pub, r.nW, r.nO, Object.assign({}, forged, { owner: r.owner.pub }), ROOM), null);
});

test('#4658: a share from an earlier run (other nonces) does not open in this run', () => {
  const r = run();
  const share = seal.ownShareFrame(r.owner, r.ownerSide, r.code, r.roomKey, 0, ROOM);
  const n = seal.randomSecret();
  assert.strictEqual(seal.openOwnShare(r.waiting, MAC, r.owner.pub, n, r.nO, share, ROOM), null, 'waiting nonce');
  assert.strictEqual(seal.openOwnShare(r.waiting, MAC, r.owner.pub, r.nW, n, share, ROOM), null, 'owner nonce');
});

test('#4658: Allow refuses a code for a different key, room, computer or run, and a missing code', () => {
  const r = run();
  const swapped = seal.newKeyPair();   // a waiting key substituted on the owner's list
  const onWaitingScreen = r.code;
  assert.throws(() => seal.ownShareFrame(r.owner, Object.assign({}, r.ownerSide, { pub: swapped.pub }), onWaitingScreen, r.roomKey, 0, ROOM), /not the one that computer shows/);
  assert.throws(() => seal.ownShareFrame(r.owner, r.ownerSide, r.code, r.roomKey, 0, 'room-other'));
  assert.throws(() => seal.ownShareFrame(r.owner, Object.assign({}, r.ownerSide, { mac: 'mac-2' }), r.code, r.roomKey, 0, ROOM));
  assert.throws(() => seal.ownShareFrame(r.owner, Object.assign({}, r.ownerSide, { nO: seal.randomSecret() }), r.code, r.roomKey, 0, ROOM));
  assert.throws(() => seal.ownShareFrame(r.owner, r.ownerSide, undefined, r.roomKey, 0, ROOM));
  assert.throws(() => seal.ownShareFrame(r.owner, r.ownerSide, '', r.roomKey, 0, ROOM));
  assert.throws(() => seal.ownShareFrame(r.owner, null, r.code, r.roomKey, 0, ROOM));
});

test('#4658: an offer counts only for this computer\'s current commitment', () => {
  const r = run();
  const f = seal.ownOfferFrame(r.owner, r.hello, r.nO);
  assert.ok(seal.checkOwnOffer(f, MAC, r.hello.commit));
  assert.strictEqual(seal.checkOwnOffer(f, 'mac-2', r.hello.commit), null, 'another computer');
  assert.strictEqual(seal.checkOwnOffer(f, MAC, seal.ownCommit(seal.randomSecret())), null, 'an older or newer commitment');
  for (const junk of [null, 'x', {}, Object.assign({}, f, { v: 2 }), Object.assign({}, f, { owner: 'nope' }), Object.assign({}, f, { nonce: 'short' })]) {
    assert.strictEqual(seal.checkOwnOffer(junk, MAC, r.hello.commit), null);
  }
});

test('#4658: a reveal counts only when it opens the commitment, for that owner', () => {
  const r = run();
  const f = seal.ownRevealFrame(MAC, r.owner.pub, r.nW);
  assert.strictEqual(seal.checkOwnReveal(f, MAC, r.owner.pub, r.hello.commit), r.nW);
  assert.strictEqual(seal.checkOwnReveal(seal.ownRevealFrame(MAC, r.owner.pub, seal.randomSecret()), MAC, r.owner.pub, r.hello.commit), null, 'a nonce that does not open the commitment');
  assert.strictEqual(seal.checkOwnReveal(f, MAC, seal.newKeyPair().pub, r.hello.commit), null, 'a reveal addressed to another owner');
  assert.strictEqual(seal.checkOwnReveal(f, 'mac-2', r.owner.pub, r.hello.commit), null, 'another computer');
  for (const junk of [null, 'x', {}, Object.assign({}, f, { v: 2 }), Object.assign({}, f, { t: 'key-own-hello' })]) {
    assert.strictEqual(seal.checkOwnReveal(junk, MAC, r.owner.pub, r.hello.commit), null);
  }
});

test('#4658: a malformed hello reads as null and never throws; one cannot be made without an id, key or nonce', () => {
  const f = seal.ownHelloFrame(seal.newKeyPair(), MAC, seal.randomSecret());
  assert.strictEqual(f.t, 'key-own-hello');
  for (const junk of [null, undefined, 'x', {}, Object.assign({}, f, { v: 2 }), Object.assign({}, f, { t: 'key-hello' }),
    Object.assign({}, f, { mac: '' }), Object.assign({}, f, { mac: 7 }), Object.assign({}, f, { mac: 'm'.repeat(129) }),
    Object.assign({}, f, { pub: 'not-a-key' }), Object.assign({}, f, { commit: 'short' })]) {
    assert.strictEqual(seal.checkOwnHello(junk), null);
  }
  assert.ok(seal.checkOwnHello(Object.assign({}, f, { mac: 'm'.repeat(128) })), '128 is the bound, not past it');
  assert.throws(() => seal.ownHelloFrame(seal.newKeyPair(), '', seal.randomSecret()));
  assert.throws(() => seal.ownHelloFrame({ pub: 'nope' }, MAC, seal.randomSecret()));
  assert.throws(() => seal.ownHelloFrame(seal.newKeyPair(), MAC, 'short'));
});

test('#4658: a tampered share or a relabelled rotation opens to null and never throws', () => {
  const r = run();
  const share = seal.ownShareFrame(r.owner, r.ownerSide, r.code, r.roomKey, 2, ROOM);
  const open = (f) => seal.openOwnShare(r.waiting, MAC, r.owner.pub, r.nW, r.nO, f, ROOM);
  const flip = (b64s) => { const b = Buffer.from(b64s, 'base64url'); b[0] ^= 1; return b.toString('base64url'); };
  assert.strictEqual(open(Object.assign({}, share, { ct: flip(share.ct) })), null, 'ciphertext');
  assert.strictEqual(open(Object.assign({}, share, { epoch: 3 })), null, 'epoch');
  assert.strictEqual(seal.openOwnShare(r.waiting, 'mac-2', r.owner.pub, r.nW, r.nO, Object.assign({}, share, { mac: 'mac-2' }), ROOM), null, 'computer id');
  // A rotation sealed between the same two keys does not open as an own-share: the associated data (frame type,
  // room, computer, epoch, nonces) keeps them apart. The 'own-share' HKDF purpose is a second wall that no test here
  // isolates (a mutant using 'rotate' stays green).
  const rot = seal.rotateFrame(r.owner, r.waiting.pub, seal.randomSecret(), 1, ROOM, 0);
  assert.strictEqual(open(Object.assign({}, rot, { t: 'key-own-share', mac: MAC, owner: r.owner.pub })), null, 'a rotate relabelled');
  assert.strictEqual(seal.openRotate(r.waiting, r.owner.pub, Object.assign({}, share, { t: 'key-rotate' }), ROOM), null, 'a share relabelled as a rotate');
  for (const junk of [null, undefined, 7, 'x', {}, { t: 'key-own-share' }, Object.assign({}, share, { nonce: 5 }), Object.assign({}, share, { v: 2 })]) {
    assert.strictEqual(open(junk), null);
  }
});
