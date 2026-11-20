'use strict';
// kosmos#8764: escrowd's signed hand-over record, as the leaving computer reads it (handoverseal.checkRecord).
// The send path is tested end to end in handoversend-8710.test.js ("the successor and the agents come from escrowd's
// record"); this file pins the bytes to kosmos-relay and checks checkRecord's own refusals.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hist = require('./devkeyhist');
const seal = require('./handoverseal');

const ESCROWD = crypto.generateKeyPairSync('ed25519');
hist.setVerifyingKeyForTests(ESCROWD.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
const ME = crypto.generateKeyPairSync('ed25519');
const T = 1_900_000_000;

function history(member, publicKey, t = T) {
  const entries = [{ kind: 'enrol', key: seal.keyHex(publicKey), at: 0, backfill: false }];
  return { org: 'org1', member, entries, issuedAt: t, signature: crypto.sign(null, hist.encodeHead('org1', member, entries, t), ESCROWD.privateKey).toString('base64url') };
}
function record(over, key = ESCROWD.privateKey) {
  const r = Object.assign({ org: 'org1', id: 'h1', from: 'm-leave', to: 'm-succ', agents: ['helper', 'clerk'], issuedAt: T }, over || {});
  return Object.assign(r, { signature: crypto.sign(null, seal.encodeRecord(r), key).toString('base64url') });
}
const ask = (over) => seal.checkRecord(Object.assign({ org: 'org1', id: 'h1', agents: ['clerk', 'helper'], record: record(),
  ownHistory: history('m-leave', ME.publicKey), ownKeyHex: seal.keyHex(ME.publicKey), now: T + 60 }, over || {}));

test('the record bytes and escrowd\'s signature match kosmos-relay handoverrec.rs byte for byte', () => {
  // The relay's vector (handoverrec.rs the_macs_vector_is_reproduced): escrow key 32 x 0x07, the history key derived
  // from it with HKDF-SHA256 (devkeyhist.rs KDF_SALT / KDF_INFO), fixed fields.
  const seed = Buffer.from(crypto.hkdfSync('sha256', Buffer.alloc(32, 7), Buffer.from('kosmos-escrowd devkeyhist salt v1'),
    Buffer.from('kosmos-escrowd devkeyhist signing key v1'), 32));
  const sk = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
  const r = { org: 'org1', id: 'h1', from: 'acct-from', to: 'acct-to', agents: ['helper', 'clerk'], issuedAt: 1_800_000_000 };
  const msg = seal.encodeRecord(r);
  assert.equal(crypto.createHash('sha256').update(msg).digest('hex'), 'd18062bd1ebd5436ef8e53ab5eb81f5951d5a68bb9e7ddb4d584782fa49d6e5d');
  assert.equal(crypto.sign(null, msg, sk).toString('base64url'), 'ytmP0yV4ewMLwzCKJSQde5fgeIBFD9t6oWBUe-HVvS5Vj5EIYTi6KV1rqLD7Hb0cdYl7qstkzVnIHzMGBunzCg');
  assert.equal(seal.RECORD_TAG.toString(), 'kosmos-escrowd-handover-record v1');
});

test('a genuine record for this computer answers the successor; the agents may come in any order', () => {
  assert.deepEqual(ask(), { ok: true, to: 'm-succ' });
});

test('every substitution is refused, and says whether it may pass later', () => {
  const stranger = crypto.generateKeyPairSync('ed25519');
  const finals = [
    ['signed by a key that is not escrowd\'s', { record: record({}, stranger.privateKey) }, /did not check/],
    ['a successor rewritten after signing', { record: Object.assign(record(), { to: 'm-other' }) }, /did not check/],
    ['an agent added after signing', { record: Object.assign(record(), { agents: ['helper', 'clerk', 'payroll'] }) }, /did not check/],
    ['another hand-over\'s record', { id: 'h2' }, /different hand-over/],
    ['another company', { org: 'org2', ownHistory: history('m-leave', ME.publicKey) }, /different hand-over/],
    ['fewer agents asked than approved', { agents: ['helper'] }, /not the ones/],
    ['other agents asked', { agents: ['helper', 'payroll'] }, /not the ones/],
    ['this computer is not the record\'s from', { ownKeyHex: seal.keyHex(stranger.publicKey) }, /not for the member this computer belongs to/],
    ['a history for another member passed as our own', { ownHistory: history('m-succ', ME.publicKey) }, /could not be checked: the device key history names a different member/],
    ['over a month old', { now: T + seal.RECORD_MAX_AGE_SECS + 1, ownHistory: history('m-leave', ME.publicKey, T + seal.RECORD_MAX_AGE_SECS) }, /too old/],
    ['not a record at all', { record: 'nope' }, /not in the form/],
    ['from and to the same member', { record: Object.assign(record(), { to: 'm-leave' }) }, /not in the form/],
    ['no own key', { ownKeyHex: null }, /own device key could not be read/],
  ];
  for (const [why, over, re] of finals) {
    const r = ask(over);
    assert.equal(r.ok, false, why);
    assert.equal(r.wait, undefined, why);
    assert.match(r.because, re, why);
  }
  const waits = [
    ['no record yet', { record: null }, /not been signed/],
    ['dated ahead of this clock', { now: T - 3600 }, /dated ahead/],
    ['no own history', { ownHistory: null }, /could not get its device keys/],
    ['an own history too old', { ownHistory: history('m-leave', ME.publicKey, T - 2 * 86400) }, /too old to trust/],
  ];
  for (const [why, over, re] of waits) {
    const r = ask(over);
    assert.equal(r.ok, false, why);
    assert.equal(r.wait, true, why);
    assert.match(r.because, re, why);
  }
});

test('without the test key only escrowd\'s SHIPPED key counts, so a record signed by any other key is refused', () => {
  hist.setVerifyingKeyForTests(null);
  try {
    const r = ask();
    assert.equal(r.ok, false);
    assert.match(r.because, /did not check/);
  } finally { hist.setVerifyingKeyForTests(ESCROWD.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)); }
});
