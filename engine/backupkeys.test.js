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
  // With the magic swapped: the associated data still differs (the kind line, and the naming key's period field),
  // and both kinds share one HPKE info.
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
  const nw = keys.wrapNamingKey(keys.newNamingKey(), member.pk, nctx);
  assert.ok(keys.unwrapNamingKey(member.sk, nw, nctx), 'CONTROL: the untampered naming wrap opens');
  for (let i = 0; i < w.length; i++) {
    const t = Buffer.from(w); t[i] ^= 0x01;
    assert.strictEqual(keys.unwrapMemberKey(r.sk, t, mctx, member.pk), null, `member wrap byte ${i}`);
    const tn = Buffer.from(nw); tn[i] ^= 0x01;
    assert.strictEqual(keys.unwrapNamingKey(member.sk, tn, nctx), null, `naming wrap byte ${i}`);
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
  // A numeric id is not a string: wrap throws, unwrap reads null (so key storage must keep one canonical string form).
  assert.throws(() => keys.wrapMemberKey(member.sk, r.pk, Object.assign({}, mctx, { epoch: 1 })), /needs a non-empty epoch/);
  const w1 = keys.wrapMemberKey(member.sk, r.pk, mctx);
  assert.strictEqual(keys.unwrapMemberKey(r.sk, w1, Object.assign({}, mctx, { epoch: 1 }), member.pk), null);
  // Only the context's OWN fields count: an inherited epoch is not one.
  assert.throws(() => keys.wrapMemberKey(member.sk, r.pk, Object.assign(Object.create({ epoch: '1' }), { org: 'org1', member: 'acct1' })), /needs a non-empty epoch/);
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

test('a known-answer member-key wrap (fixed keys and ephemeral) opens: the bytes any other unwrap service must accept', () => {
  const h = (x) => Buffer.from(x, 'hex');
  const memberSk = h('7790330b18d76c45446b7d9d1b15e87d7da80ab3b6f8cdcc0871764f1d767c9c');
  const memberPk = h('41852320ff367495fa522c94cb83af391e4e89018392725bbf2098dd931bc424');
  const recipientSk = h('95fe8f32f2036438e7f4c0e9157d5f7d730bc04618e1dd569084f67d3919d1fe');
  // Made with hpke's vector seams: member and recipient from DeriveKeyPair(32 x 0x01) and (32 x 0x02), the
  // ephemeral from ikmE = 32 x 0x03, info "kosmos-backup v1 key-wrap", context org1 / acct1 / 1.
  const wrap = h('4b424b3190ab790ecbf0704232ffe9436faeccc913b66a60e99c688a40bba4d5e2e614503d77a34af2050b776c04ad9f62ff24695eab7e73f78c9bf2bcf8cdf41670962f5d2a78a4a7b04ac79722d66709e74294');
  const got = keys.unwrapMemberKey(recipientSk, wrap, mctx, memberPk);
  assert.ok(got && got.equals(memberSk));
  // And the vector really comes from the seams (so a change to the format breaks it here, not silently).
  const s = require('./hpke').hpkeVectorSeamsForTests();
  const recip = s.deriveKeyPair(Buffer.alloc(32, 2));
  const { sharedSecret, enc } = s.encap(recip.pk, Buffer.alloc(32, 3));
  const ks = s.keySchedule(sharedSecret, Buffer.from('kosmos-backup v1 key-wrap'));
  const ct = s.aeadSeal(ks.key, s.nonceFor(ks.baseNonce, 0), keys.memberContextBytes(mctx), s.deriveKeyPair(Buffer.alloc(32, 1)).sk);
  assert.ok(Buffer.concat([Buffer.from('KBK1'), enc, ct]).equals(wrap));
});

test('namingKeyId names one naming key: stable, distinct per key, pinned, and refuses a bad key', () => {
  const nk = Buffer.alloc(32, 5);
  assert.strictEqual(keys.namingKeyId(nk), keys.namingKeyId(Buffer.from(nk)));
  assert.match(keys.namingKeyId(nk), /^[0-9a-f]{32}$/);
  assert.notStrictEqual(keys.namingKeyId(keys.newNamingKey()), keys.namingKeyId(keys.newNamingKey()));
  const crypto = require('node:crypto');
  const want = crypto.createHash('sha256').update(Buffer.from('kosmos-backup v1 naming-key-id\0')).update(nk).digest().subarray(0, 16).toString('hex');
  assert.strictEqual(keys.namingKeyId(nk), want);
  assert.throws(() => keys.namingKeyId(Buffer.alloc(31)), /naming key must be 32 bytes/);
  // Restore picks among a period's wraps by id: two keys in one period, each found by its id.
  const member = keys.newMemberKey(), a = keys.newNamingKey(), b = keys.newNamingKey();
  const wraps = [a, b].map((k) => keys.wrapNamingKey(k, member.pk, nctx));
  const byId = (id) => wraps.map((w) => keys.unwrapNamingKey(member.sk, w, nctx)).find((k) => k && keys.namingKeyId(k) === id);
  assert.ok(byId(keys.namingKeyId(b)).equals(b)); assert.ok(byId(keys.namingKeyId(a)).equals(a));
});

test('a context value is read once: a getter that passes the check and then turns hostile cannot forge a field', () => {
  let n = 0;
  const ctx = { org: 'org1', member: 'acct1', get epoch() { n++; return n === 1 ? '1' : '1\nperiod=x'; } };
  const b = keys.memberContextBytes(ctx);
  assert.strictEqual(b.toString(), 'kosmos-backup v1 member-key\norg=org1\nmember=acct1\nepoch=1');
  assert.strictEqual(n, 1);
});
