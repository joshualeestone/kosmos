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

test('every substitution is refused: another signer, another key, another hand-over, another member\'s history, a forged history, none', () => {
  const cases = [
    ['signed by another key, claiming to be the successor', { sig: seal.signSeal('ho1', sealPub, other.privateKey) }, /not signed by the colleague's own computer/],
    ['signed by another key that names itself', { sig: seal.signSeal('ho1', sealPub, other.privateKey), signer: hex(other) }, /not signed by the colleague's own computer/],
    ['the one-time key swapped after signing', { sealPub: hpkeKeyPair().pk.toString('base64') }, /not signed by the colleague's own computer/],
    ['a signature for another hand-over', { sig: seal.signSeal('ho2', sealPub, succ.privateKey) }, /not signed by the colleague's own computer/],
    ['the leaving member\'s history in place of the successor\'s', { history: history('m-leave', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }]) }, /could not be checked/],
    ['a history signed by someone other than escrowd', { history: history('m-succ', [{ kind: 'enrol', key: hex(other), at: NOW - 900, backfill: false }], { key: other.privateKey }), signer: hex(other), sig: seal.signSeal('ho1', sealPub, other.privateKey) }, /could not be checked/],
    ['a key revoked before now', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: false }, { kind: 'revoke', key: hex(succ), at: NOW - 100 }]) }, /not signed by the colleague's own computer/],
    ['no signature', { sig: undefined }, /did not sign/],
    ['a key the backfill entered (the coordinator\'s word)', { history: history('m-succ', [{ kind: 'enrol', key: hex(succ), at: NOW - 900, backfill: true }]) }, /not been enrolled by your company's admins/],
    ['no history', { history: undefined }, /could not be checked/],
  ];
  for (const [label, patch, why] of cases) {
    const r = seal.checkSeal(Object.assign(base(), patch));
    assert.equal(r.ok, false, label);
    assert.match(r.because, why, label);
  }
});

test('until escrowd\'s history key ships, every check refuses (fails closed)', () => {
  hist.setVerifyingKeyForTests(null);
  try {
    const r = seal.checkSeal(base());
    assert.equal(r.ok, false);
    assert.match(r.because, /cannot check the device key history yet/);
  } finally { hist.setVerifyingKeyForTests(crypto.createPublicKey(escrowd).export({ format: 'der', type: 'spki' }).subarray(-32)); }
});

test('the packing key must be the leaving member\'s at the grant time', () => {
  const lh = history('m-leave', [{ kind: 'enrol', key: hex(leaver), at: NOW - 900, backfill: false }, { kind: 'revoke', key: hex(leaver), at: NOW - 100 }]);
  const o = { org: 'o1', member: 'm-leave', senderPub: leaver.publicKey, history: lh, at: NOW - 200, now: NOW };
  assert.deepEqual(seal.checkSender(o), { ok: true }, 'valid when the pack was granted, though revoked since');
  assert.match(seal.checkSender(Object.assign({}, o, { at: NOW - 50 })).because, /not signed by the leaving member's own computer/);
  assert.match(seal.checkSender(Object.assign({}, o, { senderPub: other.publicKey })).because, /not signed by the leaving member's own computer/);
  assert.match(seal.checkSender(Object.assign({}, o, { member: 'm-succ' })).because, /could not be checked/);
  const bf = history('m-leave', [{ kind: 'enrol', key: hex(leaver), at: NOW - 900, backfill: true }]);
  assert.match(seal.checkSender(Object.assign({}, o, { history: bf })).because, /not been enrolled by your company's admins/);
});
