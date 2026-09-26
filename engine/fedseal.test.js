'use strict';
// kosmos#3728: the sealing primitives. A temp data root; nothing touches a real store.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-fedseal-3728-'));
process.env.AGENT_WORKFORCE_DATA = ROOT;
const store = require('./store');
const seal = require('./fedseal');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const ROOM = 'room-abc';

/** The whole handshake: owner and member end holding the same epoch-0 room key. */
function handshake() {
  const owner = seal.newKeyPair();
  const member = seal.newKeyPair();
  const s = seal.randomSecret();
  const roomKey = seal.randomSecret();
  const hello = seal.helloFrame(s, member, ROOM);
  const pinnedMember = seal.checkHello(s, hello, ROOM);
  const share = seal.shareFrame(s, owner, pinnedMember, roomKey, 0, ROOM);
  const got = seal.openShare(s, member, share, ROOM);
  return { owner, member, s, roomKey, hello, share, pinnedMember, got };
}

test('#3728: the handshake gives the member the owner\'s room key and pins both public keys', () => {
  const h = handshake();
  assert.strictEqual(h.pinnedMember, h.member.pub);
  assert.ok(h.got, 'the member could not open a genuine share');
  assert.strictEqual(h.got.roomKey, h.roomKey);
  assert.strictEqual(h.got.ownerPub, h.owner.pub);
  assert.strictEqual(h.got.epoch, 0);
});

test('#3728: a message sealed by one side opens on the other, and only there', () => {
  const h = handshake();
  const env = seal.seal(h.roomKey, 0, ROOM, { from: 'Ada', kind: 'person', text: 'hello, sealed' });
  assert.ok(seal.isSealed(env));
  assert.ok(!JSON.stringify(env).includes('hello, sealed'), 'the words travel in the clear');
  assert.deepStrictEqual(seal.open({ 0: h.got.roomKey }, ROOM, env), { from: 'Ada', kind: 'person', text: 'hello, sealed' });
  // Someone else's key, another room, another epoch, a flipped byte: nothing opens.
  assert.strictEqual(seal.open({ 0: seal.randomSecret() }, ROOM, env), null, 'a wrong key opened it');
  assert.strictEqual(seal.open({ 0: h.roomKey }, 'room-other', env), null, 'it opened in another room');
  assert.strictEqual(seal.open({ 1: h.roomKey }, ROOM, { ...env, epoch: 1 }), null, 'it opened under another epoch');
  const ct = Buffer.from(env.ct, 'base64url'); ct[0] ^= 1;
  assert.strictEqual(seal.open({ 0: h.roomKey }, ROOM, { ...env, ct: ct.toString('base64url') }), null, 'a tampered message opened');
});

test('#3728: without the invite\'s second half nobody can swap in their own key, either way', () => {
  const h = handshake();
  const mallory = seal.newKeyPair();
  const guess = seal.randomSecret();
  // The coordinator or relay replaces the member's hello with its own key: it has only a guess at s.
  assert.strictEqual(seal.checkHello(h.s, seal.helloFrame(guess, mallory, ROOM), ROOM), null, 'a forged hello was pinned');
  // Or keeps the member's MAC and swaps only the key.
  assert.strictEqual(seal.checkHello(h.s, { ...h.hello, pub: mallory.pub }, ROOM), null, 'a swapped hello key was pinned');
  // Replays a genuine hello into another room.
  assert.strictEqual(seal.checkHello(h.s, h.hello, 'room-other'), null, 'a hello replayed into another room was pinned');
  // Replaces the owner's share with one of its own (to the member's real key).
  const forged = seal.shareFrame(guess, mallory, h.member.pub, seal.randomSecret(), 0, ROOM);
  assert.strictEqual(seal.openShare(h.s, h.member, forged, ROOM), null, 'a forged share was accepted');
  // Keeps the owner's MAC and swaps the owner key it claims.
  assert.strictEqual(seal.openShare(h.s, h.member, { ...h.share, owner: mallory.pub }, ROOM), null, 'a swapped owner key was accepted');
  // CONTROL: the genuine frames still pass, so the refusals above are about the attacks.
  assert.strictEqual(seal.checkHello(h.s, h.hello, ROOM), h.member.pub);
  assert.ok(seal.openShare(h.s, h.member, h.share, ROOM));
});

test('#3728: a share sealed to one member cannot be opened by another holding the same s', () => {
  const h = handshake();
  const other = seal.newKeyPair();
  assert.strictEqual(seal.openShare(h.s, other, h.share, ROOM), null, 'a different key opened a share meant for the member');
});

test('#3728: after a revoke the remaining member reads the next epoch and the revoked one cannot', () => {
  const owner = seal.newKeyPair();
  const stays = seal.newKeyPair();
  const goes = seal.newKeyPair();
  const next = seal.randomSecret();
  const rot = seal.rotateFrame(owner, stays.pub, next, 1, ROOM);
  const got = seal.openRotate(stays, owner.pub, rot, ROOM);
  assert.deepStrictEqual(got, { epoch: 1, roomKey: next });
  // The revoked member is not sent a rotate; given the remaining member's, it cannot open it.
  assert.strictEqual(seal.openRotate(goes, owner.pub, rot, ROOM), null, 'a revoked member opened the next key');
  const env = seal.seal(next, 1, ROOM, { from: 'Owner', kind: 'person', text: 'after the revoke' });
  assert.strictEqual(seal.open({ 0: seal.randomSecret() }, ROOM, env), null, 'an old epoch key read a new message');
  assert.strictEqual(seal.open({ 1: got.roomKey }, ROOM, env).text, 'after the revoke');
});

test('#3728: only the pinned owner key can produce a rotate', () => {
  const owner = seal.newKeyPair();
  const member = seal.newKeyPair();
  const mallory = seal.newKeyPair();
  const forged = seal.rotateFrame(mallory, member.pub, seal.randomSecret(), 1, ROOM);
  assert.strictEqual(seal.openRotate(member, owner.pub, forged, ROOM), null, 'a rotate from an unpinned key was accepted');
  assert.strictEqual(seal.openRotate(member, owner.pub, seal.rotateFrame(owner, member.pub, seal.randomSecret(), 1, 'room-other'), ROOM), null,
    'a rotate for another room was accepted');
});

test('#3728: malformed frames from outside are refused, never thrown', () => {
  const me = seal.newKeyPair();
  const s = seal.randomSecret();
  const junk = [null, undefined, 1, 'x', [], {}, { t: 'key-hello' }, { t: 'key-hello', v: 1, pub: 'not-a-key', mac: '!!' },
    { t: 'key-share', v: 1, owner: me.pub, epoch: -1, nonce: 'a', ct: 'b', mac: 'c' },
    { t: 'key-share', v: 1, owner: me.pub, epoch: 0, nonce: '', ct: '', mac: '' },
    { t: 'key-rotate', v: 1, epoch: 0, nonce: 'a', ct: 'b' }, { v: 1, epoch: 0, nonce: 'AAAA', ct: 'AAAA' }];
  for (const f of junk) {
    assert.doesNotThrow(() => {
      assert.strictEqual(seal.checkHello(s, f, ROOM), null);
      assert.strictEqual(seal.openShare(s, me, f, ROOM), null);
      assert.strictEqual(seal.openRotate(me, me.pub, f, ROOM), null);
      assert.strictEqual(seal.open({ 0: seal.randomSecret() }, ROOM, f), null);
    }, JSON.stringify(f));
  }
  assert.strictEqual(seal.checkHello('short', seal.helloFrame(s, me, ROOM), ROOM), null, 'a malformed s passed');
});

test('#3728: this board\'s sealing key is made once, kept at mode 600, and never silently replaced', () => {
  const f = path.join(store.ROOT, seal.KEY_FILE);
  assert.ok(!fs.existsSync(f), 'fixture: no key yet');
  const a = seal.sealingKey();
  assert.ok(fs.existsSync(f));
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600, 'the key file is readable by others');
  const b = seal.sealingKey();
  assert.strictEqual(b.pub, a.pub, 'a second read made a new key');
  // It works as a key: a share to it opens with it.
  const owner = seal.newKeyPair();
  const s = seal.randomSecret();
  const rk = seal.randomSecret();
  assert.strictEqual(seal.openShare(s, b, seal.shareFrame(s, owner, a.pub, rk, 0, ROOM), ROOM).roomKey, rk);
  // A damaged key file is an error, not a new key (a new key would orphan every joined room).
  fs.writeFileSync(f, '{not json');
  assert.throws(() => seal.sealingKey(), /cannot make sense of it/);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{not json', 'the damaged key was overwritten');
});
