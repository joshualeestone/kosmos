'use strict';
// kosmos#4658: the own-seat compare code, which an owner's computer that arrives after a
// guest shows beside the allowing computer's "Waiting for an Allow" row.
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
// RFC 7748 section 6.1, Alice's public key: a fixed, valid X25519 key for the pinned vector.
const RFC_PUB = Buffer.from('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'hex').toString('base64url');

test('#4658: the code is ten symbols from the safe alphabet, grouped five and five', () => {
  const c = seal.compareCode(ROOM, MAC, seal.newKeyPair().pub);
  assert.match(c, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/);
});

test('#4658: the code matches a vector computed outside this module (pins the encoding both screens rely on)', () => {
  // Computed with Python's hashlib over the same JSON array, not with this code.
  assert.strictEqual(seal.compareCode(ROOM, MAC, RFC_PUB), 'RBMKZ-XU4UW');
});

test('#4658: the code is a fixed function of its inputs, so the two screens agree without talking', () => {
  const pub = seal.newKeyPair().pub;
  assert.strictEqual(seal.compareCode(ROOM, MAC, pub), seal.compareCode(ROOM, MAC, pub));
});

test('#4658: changing the room, the computer or its key changes the code', () => {
  const pub = seal.newKeyPair().pub;
  const base = seal.compareCode(ROOM, MAC, pub);
  assert.notStrictEqual(seal.compareCode('room-abd', MAC, pub), base, 'the room is bound');
  assert.notStrictEqual(seal.compareCode(ROOM, 'mac-2', pub), base, 'the waiting computer is bound');
  // The attack this code exists for: a coordinator swaps in its own key.
  assert.notStrictEqual(seal.compareCode(ROOM, MAC, seal.newKeyPair().pub), base, 'the seal key is bound');
});

test('#4658: the code spreads over the alphabet (no stuck position)', () => {
  const seen = Array.from({ length: 10 }, () => new Set());
  const codes = new Set();
  for (let i = 0; i < 400; i++) {
    const c = seal.compareCode(ROOM, MAC, seal.newKeyPair().pub).replace('-', '');
    codes.add(c);
    for (let j = 0; j < 10; j++) seen[j].add(c[j]);
  }
  assert.strictEqual(codes.size, 400, 'no two keys gave the same code');
  // 400 draws over 31 symbols leave a given symbol unseen with chance about 2e-6 per position.
  for (let j = 0; j < 10; j++) assert.strictEqual(seen[j].size, 31, `position ${j} saw ${seen[j].size} of 31 symbols`);
});

test('#4658: a missing or malformed input gives no code, so no Allow can be offered on it', () => {
  const pub = seal.newKeyPair().pub;
  assert.strictEqual(seal.compareCode('', MAC, pub), null);
  assert.strictEqual(seal.compareCode(ROOM, '', pub), null);
  assert.strictEqual(seal.compareCode(ROOM, 7, pub), null);
  assert.strictEqual(seal.compareCode(null, MAC, pub), null);
  assert.strictEqual(seal.compareCode(ROOM, MAC, undefined), null);
  assert.strictEqual(seal.compareCode(ROOM, MAC, 'not-a-key'), null);
  assert.strictEqual(seal.compareCode(ROOM, MAC, pub.slice(0, -2)), null, 'a truncated key');
});

/* ---- own-share ---- */

function ownShare() {
  const owner = seal.newKeyPair();
  const waiting = seal.newKeyPair();
  const roomKey = seal.randomSecret();
  const code = seal.compareCode(ROOM, MAC, waiting.pub);   // what the waiting computer's screen shows
  const frame = seal.ownShareFrame(owner, waiting.pub, MAC, code, roomKey, 2, ROOM);
  return { owner, waiting, roomKey, code, frame };
}

test('#4658: the waiting computer opens the own-share and pins the sealing board\'s key', () => {
  const { owner, waiting, roomKey, frame } = ownShare();
  assert.deepStrictEqual(seal.openOwnShare(waiting, MAC, frame, ROOM), { ownerPub: owner.pub, epoch: 2, roomKey });
});

test('#4658: Allow refuses when the code the person confirmed is for a different key (the swapped-key attack)', () => {
  const owner = seal.newKeyPair();
  const real = seal.newKeyPair();
  const swapped = seal.newKeyPair();   // the key a coordinator substituted on the allowing board's list
  const onWaitingScreen = seal.compareCode(ROOM, MAC, real.pub);
  assert.throws(() => seal.ownShareFrame(owner, swapped.pub, MAC, onWaitingScreen, seal.randomSecret(), 0, ROOM), /not the one that computer shows/);
});

test('#4658: Allow refuses a code for another room or another computer, and a missing code', () => {
  const owner = seal.newKeyPair();
  const w = seal.newKeyPair();
  const rk = seal.randomSecret();
  assert.throws(() => seal.ownShareFrame(owner, w.pub, MAC, seal.compareCode('room-other', MAC, w.pub), rk, 0, ROOM));
  assert.throws(() => seal.ownShareFrame(owner, w.pub, MAC, seal.compareCode(ROOM, 'mac-2', w.pub), rk, 0, ROOM));
  assert.throws(() => seal.ownShareFrame(owner, w.pub, MAC, undefined, rk, 0, ROOM));
  assert.throws(() => seal.ownShareFrame(owner, w.pub, MAC, '', rk, 0, ROOM));
});

test('#4658: the confirmed code is compared without case, spaces or the dash', () => {
  const owner = seal.newKeyPair();
  const w = seal.newKeyPair();
  const code = seal.compareCode(ROOM, MAC, w.pub);
  const loose = ' ' + code.toLowerCase().replace('-', ' ') + ' ';
  const frame = seal.ownShareFrame(owner, w.pub, MAC, loose, seal.randomSecret(), 0, ROOM);
  assert.ok(seal.openOwnShare(w, MAC, frame, ROOM));
  assert.strictEqual(seal.sameCompareCode(code, code.replace(/.$/, (c) => (c === '2' ? '3' : '2'))), false, 'one symbol off is not the same');
});

test('#4658: nobody but the waiting computer opens it, and not in another room or for another computer', () => {
  const { frame } = ownShare();
  const { waiting } = ownShare();
  assert.strictEqual(seal.openOwnShare(seal.newKeyPair(), MAC, frame, ROOM), null, 'another key');
  const mine = ownShare();
  assert.strictEqual(seal.openOwnShare(mine.waiting, MAC, mine.frame, 'room-other'), null, 'another room');
  assert.strictEqual(seal.openOwnShare(mine.waiting, 'mac-2', mine.frame, ROOM), null, 'another computer id');
  assert.strictEqual(seal.openOwnShare(waiting, MAC, frame, ROOM), null, 'another waiting computer\'s share');
});

test('#4658: a tampered own-share, a renamed computer field or a guest frame opens to null and never throws', () => {
  const { owner, waiting, frame } = ownShare();
  const flip = (b64s) => { const b = Buffer.from(b64s, 'base64url'); b[0] ^= 1; return b.toString('base64url'); };
  assert.strictEqual(seal.openOwnShare(waiting, MAC, Object.assign({}, frame, { ct: flip(frame.ct) }), ROOM), null, 'ciphertext');
  assert.strictEqual(seal.openOwnShare(waiting, MAC, Object.assign({}, frame, { epoch: 3 }), ROOM), null, 'epoch');
  assert.strictEqual(seal.openOwnShare(waiting, MAC, Object.assign({}, frame, { owner: seal.newKeyPair().pub }), ROOM), null, 'owner key');
  assert.strictEqual(seal.openOwnShare(waiting, 'mac-2', Object.assign({}, frame, { mac: 'mac-2' }), ROOM), null, 'computer id');
  // A rotation sealed between the same two keys does not open as an own-share. The associated data
  // (frame type, room, computer, epoch) is what keeps them apart; the 'own-share' HKDF purpose is a
  // second wall that no test here isolates (a mutant using 'rotate' stays green).
  const rot = seal.rotateFrame(owner, waiting.pub, seal.randomSecret(), 1, ROOM, 0);
  assert.strictEqual(seal.openOwnShare(waiting, MAC, Object.assign({}, rot, { t: 'key-own-share', mac: MAC, owner: frame.owner }), ROOM), null, 'a rotate relabelled');
  for (const junk of [null, undefined, 7, 'x', {}, { t: 'key-own-share' }, Object.assign({}, frame, { nonce: 5 }), Object.assign({}, frame, { v: 2 })]) {
    assert.strictEqual(seal.openOwnShare(waiting, MAC, junk, ROOM), null);
  }
});

test('#4658: an own-share does not open as a rotate from the same board (the associated data differs)', () => {
  const { owner, waiting, frame } = ownShare();
  assert.strictEqual(seal.openRotate(waiting, owner.pub, Object.assign({}, frame, { t: 'key-rotate', epoch: 2 }), ROOM), null);
});

/* ---- own-hello ---- */

test('#4658: an own computer\'s hello carries its id and key, and reads back as exactly those', () => {
  const me = seal.newKeyPair();
  const f = seal.ownHelloFrame(me, MAC);
  assert.strictEqual(f.t, 'key-own-hello', 'a key- frame, so fedseats routes it to the sealing handler');
  assert.deepStrictEqual(seal.checkOwnHello(f), { mac: MAC, pub: me.pub });
});

test('#4658: the own-share frame is a key- frame too', () => {
  assert.strictEqual(ownShare().frame.t, 'key-own-share');
});

test('#4658: a malformed hello reads as null and never throws; a hello cannot be made without an id or key', () => {
  const f = seal.ownHelloFrame(seal.newKeyPair(), MAC);
  for (const junk of [null, undefined, 'x', {}, Object.assign({}, f, { v: 2 }), Object.assign({}, f, { t: 'key-hello' }),
    Object.assign({}, f, { mac: '' }), Object.assign({}, f, { mac: 7 }), Object.assign({}, f, { mac: 'm'.repeat(129) }),
    Object.assign({}, f, { pub: 'not-a-key' })]) {
    assert.strictEqual(seal.checkOwnHello(junk), null);
  }
  assert.ok(seal.checkOwnHello(Object.assign({}, f, { mac: 'm'.repeat(128) })), '128 is the bound, not past it');
  assert.throws(() => seal.ownHelloFrame(seal.newKeyPair(), ''));
  assert.throws(() => seal.ownHelloFrame({ pub: 'nope' }, MAC));
});
