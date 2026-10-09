'use strict';
/* #5535 E0.6: engine/backupkeys.js, the pure half of the backup keys (member key wraps and per-period naming keys). */
const test = require('node:test');
const assert = require('node:assert');
const keys = require('./backupkeys');
const { hpkeKeyPair, hpkeSeal } = require('./hpke');

const mctx = { org: 'org1', member: 'acct1', epoch: '1' };
const nctx = { org: 'org1', member: 'acct1', epoch: '1', period: '2026-W41' };

test('a member key wrapped to a recipient opens with that recipient and derives to the member public key', () => {
  const member = keys.newMemberKey(), escrow = hpkeKeyPair();
  const w = keys.wrapMemberKey(member.sk, escrow.pk, mctx);
  assert.strictEqual(w.length, 4 + 32 + 32 + 16, 'magic, enc, the 32-byte secret, the tag');
  assert.ok(w.subarray(0, 4).equals(Buffer.from('KBK1')));
  const back = keys.unwrapMemberKey(escrow.sk, w, mctx, member.pk);
  assert.ok(back && back.equals(member.sk));
});

test('the same wrap form serves escrow, the device and a destination: each opens only with its own key', () => {
  const member = keys.newMemberKey();
  const recips = [hpkeKeyPair(), hpkeKeyPair(), hpkeKeyPair()];
  const wraps = recips.map((r) => keys.wrapMemberKey(member.sk, r.pk, mctx));
  recips.forEach((r, i) => wraps.forEach((w, j) => {
    const got = keys.unwrapMemberKey(r.sk, w, mctx, member.pk);
    if (i === j) assert.ok(got && got.equals(member.sk), `recipient ${i} opens its own wrap`);
    else assert.strictEqual(got, null, `recipient ${i} opened wrap ${j}`);
  }));
});

test('a member-key wrap opens only under its own context: each field changed refuses', () => {
  const member = keys.newMemberKey(), r = hpkeKeyPair();
  const w = keys.wrapMemberKey(member.sk, r.pk, mctx);
  assert.ok(keys.unwrapMemberKey(r.sk, w, mctx, member.pk), 'CONTROL: the right context opens');
  for (const k of Object.keys(mctx)) {
    assert.strictEqual(keys.unwrapMemberKey(r.sk, w, Object.assign({}, mctx, { [k]: mctx[k] + 'x' }), member.pk), null, k);
  }
});

test('unwrapMemberKey refuses a wrap whose key does not derive to the expected public key (and requires one)', () => {
  const member = keys.newMemberKey(), other = keys.newMemberKey(), r = hpkeKeyPair();
  const w = keys.wrapMemberKey(member.sk, r.pk, mctx);
  assert.strictEqual(keys.unwrapMemberKey(r.sk, w, mctx, other.pk), null, 'another member key');
  assert.strictEqual(keys.unwrapMemberKey(r.sk, w, mctx), null, 'no expected key');
  assert.strictEqual(keys.unwrapMemberKey(r.sk, w, mctx, member.pk.subarray(0, 31)), null, 'a short expected key');
});

test('a naming key wrapped to the member public key opens with the member private key, only for its period', () => {
  const member = keys.newMemberKey(), nk = keys.newNamingKey();
  assert.strictEqual(nk.length, 32);
  const w = keys.wrapNamingKey(nk, member.pk, nctx);
  assert.strictEqual(w.length, 4 + 32 + 32 + 16, 'magic, enc, the 32-byte secret, the tag');
  assert.ok(w.subarray(0, 4).equals(Buffer.from('KBN1')));
  const back = keys.unwrapNamingKey(member.sk, w, nctx);
  assert.ok(back && back.equals(nk));
  for (const k of Object.keys(nctx)) {
    assert.strictEqual(keys.unwrapNamingKey(member.sk, w, Object.assign({}, nctx, { [k]: nctx[k] + 'x' })), null, k);
  }
  assert.strictEqual(keys.unwrapNamingKey(keys.newMemberKey().sk, w, nctx), null, 'another member key');
});

test('a member-key wrap never opens as a naming key, nor the reverse (the magic and the kind line differ)', () => {
  const member = keys.newMemberKey();
  // A member key wrapped to the member's own public key, opened as a naming key with the same ids.
  const mw = keys.wrapMemberKey(member.sk, member.pk, mctx);
  assert.strictEqual(keys.unwrapNamingKey(member.sk, mw, nctx), null);
  // With the magic swapped, so only the kind line in the associated data separates them (both share one info).
  const swapped = Buffer.concat([Buffer.from('KBN1'), mw.subarray(4)]);
  assert.strictEqual(keys.unwrapNamingKey(member.sk, swapped, nctx), null);
  const nw = keys.wrapNamingKey(keys.newNamingKey(), member.pk, nctx);
  assert.strictEqual(keys.unwrapMemberKey(member.sk, Buffer.concat([Buffer.from('KBK1'), nw.subarray(4)]), mctx, member.pk), null);
  // CONTROL: the member-key wrap to its own public key does open as a member key.
  assert.ok(keys.unwrapMemberKey(member.sk, mw, mctx, member.pk));
});

test('a tampered byte anywhere, a truncated or padded wrap, and non-bytes all refuse with null, never a throw', () => {
  const member = keys.newMemberKey(), r = hpkeKeyPair();
  const w = keys.wrapMemberKey(member.sk, r.pk, mctx);
  for (let i = 0; i < w.length; i++) {
    const t = Buffer.from(w); t[i] ^= 0x01;
    assert.strictEqual(keys.unwrapMemberKey(r.sk, t, mctx, member.pk), null, `byte ${i}`);
  }
  for (const bad of [w.subarray(0, w.length - 1), Buffer.concat([w, Buffer.alloc(1)]), Buffer.alloc(0), 'KBK1', null, undefined, 42, {}]) {
    assert.strictEqual(keys.unwrapMemberKey(r.sk, bad, mctx, member.pk), null);
    assert.strictEqual(keys.unwrapNamingKey(member.sk, bad, nctx), null);
  }
  // A bad recipient key or context on unwrap is also null, not a throw.
  assert.strictEqual(keys.unwrapMemberKey(Buffer.alloc(31), w, mctx, member.pk), null);
  assert.strictEqual(keys.unwrapMemberKey(r.sk, w, { org: 'o' }, member.pk), null);
  assert.strictEqual(keys.unwrapNamingKey(member.sk, keys.wrapNamingKey(keys.newNamingKey(), member.pk, nctx), { org: 'o' }), null);
});

test('wrap throws on a caller mistake: key sizes, a bad context, a non-canonical recipient key', () => {
  const member = keys.newMemberKey(), r = hpkeKeyPair();
  assert.throws(() => keys.wrapMemberKey(Buffer.alloc(31), r.pk, mctx), /member key must be 32 bytes/);
  assert.throws(() => keys.wrapMemberKey(member.sk, Buffer.alloc(33), mctx), /recipient public key must be 32 bytes/);
  assert.throws(() => keys.wrapMemberKey(member.sk, r.pk, { org: 'o', member: 'm' }), /needs a non-empty epoch/);
  assert.throws(() => keys.wrapMemberKey(member.sk, r.pk, Object.assign({}, mctx, { member: 'a\nperiod=x' })), /needs a non-empty member/);
  assert.throws(() => keys.wrapMemberKey(member.sk, r.pk, Object.assign({}, mctx, { org: 'x'.repeat(129) })), /needs a non-empty org/);
  assert.throws(() => keys.wrapNamingKey(Buffer.alloc(16), member.pk, nctx), /naming key must be 32 bytes/);
  assert.throws(() => keys.wrapNamingKey(keys.newNamingKey(), member.pk, mctx), /needs a non-empty period/);
  const nonCanonical = Buffer.alloc(32, 0xff);   // bit 255 set: hpke refuses it, since such a wrap could never open
  assert.throws(() => keys.wrapMemberKey(member.sk, nonCanonical, mctx), /canonical/);
});

test('the associated-data bytes are pinned (any other implementation of the unwrap service must match them)', () => {
  assert.strictEqual(keys.memberContextBytes(mctx).toString(), 'kosmos-backup v1 member-key\norg=org1\nmember=acct1\nepoch=1');
  assert.strictEqual(keys.namingContextBytes(nctx).toString(), 'kosmos-backup v1 naming-key\norg=org1\nmember=acct1\nepoch=1\nperiod=2026-W41');
  // Extra fields are ignored, not appended: the bytes depend on the named fields only.
  assert.ok(keys.memberContextBytes(Object.assign({ period: 'p' }, mctx)).equals(keys.memberContextBytes(mctx)));
});

test('a Uint8Array works wherever a Buffer does', () => {
  const member = keys.newMemberKey(), r = hpkeKeyPair();
  const w = keys.wrapMemberKey(new Uint8Array(member.sk), new Uint8Array(r.pk), mctx);
  const back = keys.unwrapMemberKey(new Uint8Array(r.sk), new Uint8Array(w), mctx, new Uint8Array(member.pk));
  assert.ok(back && back.equals(member.sk));
});

test('fresh keys are fresh: two member keys and two naming keys differ', () => {
  assert.ok(!keys.newMemberKey().sk.equals(keys.newMemberKey().sk));
  assert.ok(!keys.newNamingKey().equals(keys.newNamingKey()));
});

test('wraps are not authenticated, so a FORGED wrap (made by anyone with the public key) is held to the key checks', () => {
  const member = keys.newMemberKey(), escrow = hpkeKeyPair();
  const info = Buffer.from('kosmos-backup v1 key-wrap');
  const forge = (magic, pk, aad, secret) => { const { enc, ct } = hpkeSeal(pk, info, aad, secret); return Buffer.concat([Buffer.from(magic), enc, ct]); };
  // A forged member-key wrap of ANOTHER key, under the right context: refused by the expected public key.
  const other = keys.newMemberKey();
  assert.strictEqual(keys.unwrapMemberKey(escrow.sk, forge('KBK1', escrow.pk, keys.memberContextBytes(mctx), other.sk), mctx, member.pk), null);
  // A forged wrap of a secret that is not 32 bytes: refused for both kinds.
  assert.strictEqual(keys.unwrapNamingKey(member.sk, forge('KBN1', member.pk, keys.namingContextBytes(nctx), Buffer.alloc(31, 7)), nctx), null);
  assert.strictEqual(keys.unwrapNamingKey(member.sk, forge('KBN1', member.pk, keys.namingContextBytes(nctx), Buffer.alloc(33, 7)), nctx), null);
  // CONTROL: a forged naming-key wrap of 32 bytes DOES open (nothing can tell it from a real one): the defence is
  // that chunk names then fail to verify on restore, not this function.
  const fake = Buffer.alloc(32, 9);
  const got = keys.unwrapNamingKey(member.sk, forge('KBN1', member.pk, keys.namingContextBytes(nctx), fake), nctx);
  assert.ok(got && got.equals(fake));
});
