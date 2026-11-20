'use strict';
/* kosmos#8733: the one-time key tied to the successor's computer, and the pack's signer to the leaving member's, through
   escrowd's signed device-key history. The history fixture is shown to verify honestly first, so a refusal below
   cannot come from a broken fixture. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hist = require('./devkeyhist');
const seal = require('./handoverseal');
const { hpkeKeyPair } = require('./hpke');

const NOW = 1_800_000_000;
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const escrowd = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, 7)]), format: 'der', type: 'pkcs8' });
hist.setVerifyingKeyForTests(crypto.createPublicKey(escrowd).export({ format: 'der', type: 'spki' }).subarray(-32));

const succ = crypto.generateKeyPairSync('ed25519');    // the successor's computer
const other = crypto.generateKeyPairSync('ed25519');   // anyone else (the coordinator, an attacker)
const leaver = crypto.generateKeyPairSync('ed25519');  // the leaving member's computer
const hex = (k) => seal.keyHex(k.publicKey);
function history(member, entries, { org = 'o1', issuedAt = NOW - 60, key = escrowd } = {}) {
  const msg = hist.encodeHead(org, member, entries, issuedAt);
  return { org, member, entries, issuedAt, signature: crypto.sign(null, msg, key).toString('base64url') };
}
const succHist = history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }]);
const sealPub = hpkeKeyPair().pk.toString('base64');
const base = () => ({ org: 'o1', member: 'm-succ', id: 'ho1', sealPub, sig: seal.signSeal('ho1', sealPub, succ.privateKey), signer: hex(succ), history: succHist, now: NOW });

test('the fixture history verifies honestly', () => {
  assert.equal(hist.verify(succHist, { org: 'o1', member: 'm-succ', now: NOW }).ok, true);
});

test('a key signed by the successor\'s own computer, in escrowd\'s history, is accepted', () => {
  assert.deepEqual(seal.checkSeal(base()), { ok: true });
});

test('every substitution is refused, and each says whether it may pass later (wait) or never will', () => {
  const FINAL = false, WAIT = true;
  const cases = [
    ['signed by another key, claiming to be the successor', { sig: seal.signSeal('ho1', sealPub, other.privateKey) }, /not signed by the colleague's own computer/, FINAL],
    // Escrowd does not list that key for the successor at all: maybe an enrolment not finished, so it waits (bounded by
    // the caller), and nothing is packed meanwhile.
    ['signed by another key that names itself', { sig: seal.signSeal('ho1', sealPub, other.privateKey), signer: hex(other) }, /not been enrolled by your company's admins yet/, WAIT],
    ['the one-time key swapped after signing', { sealPub: hpkeKeyPair().pk.toString('base64') }, /not signed by the colleague's own computer/, FINAL],
    ['a signature for another hand-over', { sig: seal.signSeal('ho2', sealPub, succ.privateKey) }, /not signed by the colleague's own computer/, FINAL],
    ['the leaving member\'s history in place of the successor\'s', { history: history('m-leave', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }]) }, /names a different member/, FINAL],
    ['another company\'s history', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }], { org: 'o2' }) }, /names a different member/, FINAL],
    ['a history signed by someone other than escrowd', { history: history('m-succ', [{ kind: 'enrol', key: hex(other), at: NOW - 900, backfill: false }], { key: other.privateKey }), signer: hex(other), sig: seal.signSeal('ho1', sealPub, other.privateKey) }, /escrowd's signature on the device key history did not check/, FINAL],
    ['a key revoked before now', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }, { kind: 'revoke', key: hex(succ), at: NOW - 100 }]) }, /no longer the colleague's/, FINAL],
    ['no signature', { sig: undefined }, /did not sign/, FINAL],
    // Review 5: a forged signature is final even while escrowd cannot be asked (the signature needs no history).
    ['a forged signature with no history', { sig: seal.signSeal('ho1', sealPub, other.privateKey), history: null }, /not signed by the colleague's own computer/, FINAL],
    ['a retired signer (the relay sends null) with no history', { signer: null, history: null }, /not signed by the colleague's own computer/, FINAL],
    // Review 5: at exactly the revoke second the key is revoked (final), not absent.
    ['revoked at exactly now', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }, { kind: 'revoke', key: hex(succ), at: NOW }], { issuedAt: NOW }) }, /no longer the colleague's/, FINAL],
    // escrowd enrols a key once, so a backfilled key never becomes an admin-enrolled one: final, said as such.
    ['a key the backfill entered (the coordinator\'s word)', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: true }]) }, /carried over from before your company's admins enrolled computers/, FINAL],
    // Enrolled a moment after this computer's clock (escrowd's clock is ahead, within the skew verify allows): waits.
    ['a key enrolled a moment after this computer\'s clock', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW + 60, backfill: false }], { issuedAt: NOW + 120 }) }, /not been enrolled by your company's admins yet/, WAIT],
    ['no history (escrowd could not be asked)', { history: undefined }, /could not get its device keys/, WAIT],
    ['a null history', { history: null }, /could not get its device keys/, WAIT],
    ['a history too old to trust', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 200000, backfill: false }], { issuedAt: NOW - 100000 }) }, /too old/, WAIT],
    ['a history dated ahead of this computer\'s clock', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }], { issuedAt: NOW + 3600 }) }, /dated in the future/, WAIT],
  ];
  for (const [label, patch, why, wait] of cases) {
    const r = seal.checkSeal(Object.assign(base(), patch));
    assert.equal(r.ok, false, label);
    assert.match(r.because, why, label);
    assert.equal(r.wait === true, wait, `${label}: ${wait ? 'waits' : 'final'}`);
  }
});

// The relay's own vector (kosmos-relay coordinator/src/handover.rs tests): the bytes /key verifies. A change to
// sealMessage on either side fails here or there, never only in production.
test('sealMessage matches kosmos-relay handover.rs seal_message byte for byte', () => {
  const ID = '0123456789abcdef0123456789abcdef';
  const SEAL_PUB = Buffer.alloc(32, 9).toString('base64');
  const MSG_HEX = '000000176b6f736d6f732d68616e646f7665722d7365616c207631000000203031323334353637383961626364656630313233343536373839616263646566000000200909090909090909090909090909090909090909090909090909090909090909';
  assert.equal(seal.sealMessage(ID, SEAL_PUB).toString('hex'), MSG_HEX);
  const sk = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, 7)]), format: 'der', type: 'pkcs8' });
  assert.equal(seal.signSeal(ID, SEAL_PUB, sk), '03TeUTpwlMzWgCmpCoCTceW-4KHH1kjfD7BpFHgON39FX6AIWDnYK0re1fVYs_bSHqRv1-oan9KeRgufx0eTAQ');
});

test('without the test key, only escrowd\'s SHIPPED key counts, so a history signed by any other key is refused', () => {
  // VERIFYING_KEY shipped in #8754, so clearing the test stand-in falls back to it, and this fixture's key is not it.
  hist.setVerifyingKeyForTests(null);
  try {
    const r = seal.checkSeal(base());
    assert.equal(r.ok, false);
    assert.match(r.because, /escrowd's signature on the device key history did not check/);
  } finally { hist.setVerifyingKeyForTests(crypto.createPublicKey(escrowd).export({ format: 'der', type: 'spki' }).subarray(-32)); }
});

// `at` is the time the key must have been valid. The receiver passes now today; a signed pack time is kosmos#8764.
test('the packing key must be the leaving member\'s at the time asked (today: now)', () => {
  const lh = history('m-leave', [{ kind: 'enrol', key: hex(leaver), at: NOW - 900, backfill: false }, { kind: 'revoke', key: hex(leaver), at: NOW - 100 }]);
  const o = { org: 'o1', member: 'm-leave', senderPub: leaver.publicKey, history: lh, at: NOW - 200, now: NOW };
  assert.deepEqual(seal.checkSender(o), { ok: true }, 'valid when the pack was granted, though revoked since');
  const r = (patch) => seal.checkSender(Object.assign({}, o, patch));
  // What the receiver passes today, at = now: a key revoked since the pack was made is refused (final).
  assert.match(r({ at: NOW }).because, /no longer the leaving member's/);
  assert.equal(r({ at: NOW }).wait, undefined);
  // Final: listed for the leaving member, but not valid then (revoked); a history for another member.
  assert.match(r({ at: NOW - 50 }).because, /no longer the leaving member's/);
  assert.equal(r({ at: NOW - 50 }).wait, undefined, 'revoked is final');
  assert.match(r({ member: 'm-succ' }).because, /names a different member/);
  assert.equal(r({ member: 'm-succ' }).wait, undefined);
  // Waiting: a packing key escrowd does not list at all (an enrolment not finished), no history. (A backfill entry is
  // final, below.)
  assert.match(r({ senderPub: other.publicKey }).because, /not been enrolled by your company's admins yet/);
  assert.equal(r({ senderPub: other.publicKey }).wait, true);
  const bf = history('m-leave', [{ kind: 'enrol', key: hex(leaver), at: NOW - 900, backfill: true }]);
  assert.equal(r({ history: bf }).wait, undefined, 'a backfilled packing key is final');
  assert.match(r({ history: bf }).because, /carried over/);
  // Stale or ahead of this computer's clock: waits (review 2: no test caught this being final).
  const old = history('m-leave', [{ kind: 'enrol', key: hex(leaver), at: NOW - 200000, backfill: false }], { issuedAt: NOW - 100000 });
  assert.equal(r({ history: old, at: NOW, now: NOW }).wait, true);
  assert.match(r({ history: old, at: NOW, now: NOW }).because, /too old/);
  const ahead = history('m-leave', [{ kind: 'enrol', key: hex(leaver), at: NOW - 900, backfill: false }], { issuedAt: NOW + 3600 });
  assert.equal(r({ history: ahead }).wait, true);
  assert.equal(r({ history: null }).wait, true);
  assert.match(r({ history: null }).because, /could not get its device keys/);
});
