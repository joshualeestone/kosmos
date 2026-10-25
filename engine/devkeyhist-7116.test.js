'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits

// kosmos#7116 slice 1: the device-key history check. Refusals are asserted on their reason, and the fixture that
// produces them is shown to verify honestly in this file, so a refusal cannot come from a broken fixture.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const hist = require('./devkeyhist');

const NOW = 1_800_000_000;
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const escrowd = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.alloc(32, 7)]), format: 'der', type: 'pkcs8' });
const VK = crypto.createPublicKey(escrowd).export({ format: 'der', type: 'spki' }).subarray(-32);
const K1 = '11'.repeat(32);
const K2 = '22'.repeat(32);
const ATTACKER = 'aa'.repeat(32);

const BASE = [
  { kind: 'enrol', key: K1, at: NOW - 900, backfill: true },
  { kind: 'revoke', key: K1, at: NOW - 500 },
  { kind: 'enrol', key: K2, at: NOW - 500, backfill: false },
];

/* What escrowd would hand out: the entries, signed under a fresh head. */
function signed(entries, { org = 'o1', member = 'm1', issuedAt = NOW - 60, key = escrowd } = {}) {
  const msg = hist.encodeHead(org, member, entries, issuedAt);
  assert.ok(msg, 'fixture: the entries must be encodable');
  return { org, member, entries, issuedAt, signature: crypto.sign(null, msg, key).toString('base64url') };
}
const opts = { verifyingKey: VK, now: NOW, org: 'o1', member: 'm1' };

test('an honest history verifies and names each key with its window', () => {
  const r = hist.verify(signed(BASE), opts);
  assert.strictEqual(r.ok, true, r.because);
  assert.deepStrictEqual(r.keys, [
    { key: K1, from: NOW - 900, until: NOW - 500, backfill: true },
    { key: K2, from: NOW - 500, until: null, backfill: false },
  ]);
});

test('the card\'s attack: a key the coordinator alone supplies is not in the history, so no snapshot opens under it', () => {
  const { keys } = hist.verify(signed(BASE), opts);
  assert.ok(hist.keyAt(keys, K2, NOW - 100), 'control: the member\'s real key is found at that time');
  assert.strictEqual(hist.keyAt(keys, ATTACKER, NOW - 100), null);
});

test('the coordinator cannot add its key to the entries: the chain no longer matches escrowd\'s signature', () => {
  const h = signed(BASE);
  const forged = { ...h, entries: [...h.entries, { kind: 'enrol', key: ATTACKER, at: NOW - 100, backfill: false }] };
  assert.strictEqual(hist.verify(h, opts).ok, true, 'control');
  assert.match(hist.verify(forged, opts).because, /signature/);
});

test('a subset is refused: dropping the revoke breaks the signature', () => {
  const h = signed(BASE);
  const cut = { ...h, entries: h.entries.filter((e) => e.kind !== 'revoke') };
  assert.match(hist.verify(cut, opts).because, /signature/);
});

test('an old head is refused, so a genuine but shorter history cannot be replayed to hide a later revoke', () => {
  const older = signed([{ ...BASE[0], at: NOW - 3 * 24 * 3600 }], { issuedAt: NOW - 2 * 24 * 3600 });
  assert.strictEqual(hist.verify(older, { ...opts, now: older.issuedAt + 60 }).ok, true, 'control: fresh at its own time');
  assert.match(hist.verify(older, opts).because, /too old/);
  assert.strictEqual(hist.verify(signed(BASE.map((e) => ({ ...e, at: e.at - 2 * 24 * 3600 })), { issuedAt: NOW - 24 * 3600 + 1 }), opts).ok, true, 'control: just inside the bound');
});

test('a head dated in the future is refused beyond the clock skew allowance', () => {
  assert.strictEqual(hist.verify(signed(BASE, { issuedAt: NOW + 299 }), opts).ok, true, 'control: inside the skew');
  assert.match(hist.verify(signed(BASE, { issuedAt: NOW + 301 }), opts).because, /future/);
});

test('fails CLOSED with no verifying key: the shipped constant is null and that refuses (unlike orgkeypin.js)', () => {
  assert.strictEqual(hist.VERIFYING_KEY, null, 'this test assumes the key has not shipped; revisit when it does');
  const h = signed(BASE);
  assert.strictEqual(hist.verify(h, opts).ok, true, 'control: the same history verifies with a key');
  assert.match(hist.verify(h, {}).because, /cannot check/);
  for (const bad of [null, undefined, Buffer.alloc(31), 'x'.repeat(64), VK.toString('hex')]) {
    assert.strictEqual(hist.verify(h, { ...opts, verifyingKey: bad }).ok, false, `verifyingKey ${String(bad).slice(0, 12)} must not count`);
  }
});

test('a signature by any key but escrowd\'s is refused', () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.match(hist.verify(signed(BASE, { key: other }), opts).because, /signature/);
});

test('editing the org or member named in a signed history breaks the signature', () => {
  const h = signed(BASE);
  assert.match(hist.verify({ ...h, member: 'm2' }, { ...opts, member: 'm2' }).because, /signature/);
  assert.match(hist.verify({ ...h, org: 'o2' }, { ...opts, org: 'o2' }).because, /signature/);
});

test('a GENUINE history for another member is refused for this member (a coordinator substituting a whole history)', () => {
  const theirs = signed([{ kind: 'enrol', key: ATTACKER, at: NOW - 300, backfill: false }], { member: 'attacker-member' });
  assert.strictEqual(hist.verify(theirs, { ...opts, member: 'attacker-member' }).ok, true, 'control: it is genuine for its own member');
  assert.match(hist.verify(theirs, opts).because, /different member/);
  assert.match(hist.verify(signed(BASE, { org: 'o2' }), opts).because, /different member/, 'another org');
});

test('verify refuses when the caller does not name the org and member being restored', () => {
  const h = signed(BASE);
  for (const [org, member] of [[undefined, 'm1'], ['o1', undefined], ['', 'm1'], ['o1', ''], [7, 'm1']]) {
    assert.match(hist.verify(h, { verifyingKey: VK, now: NOW, org, member }).because, /without naming/, `${org}/${member}`);
  }
});

test('signed but impossible logs are refused, each against an honest twin', () => {
  const cases = [
    ['re-enrol of a revoked key', [...BASE, { kind: 'enrol', key: K1, at: NOW - 100, backfill: false }], /twice/],
    ['revoke of a key never enrolled', [...BASE, { kind: 'revoke', key: ATTACKER, at: NOW - 100 }], /never enrolled/],
    ['double revoke', [...BASE, { kind: 'revoke', key: K1, at: NOW - 100 }], /twice/],
    ['time going backwards', [...BASE, { kind: 'revoke', key: K2, at: NOW - 600 }], /dated before/],
    ['an entry dated after the head that signed it', [...BASE, { kind: 'revoke', key: K2, at: NOW - 10 }], /after escrowd signed/],
  ];
  assert.strictEqual(hist.verify(signed([...BASE, { kind: 'revoke', key: K2, at: NOW - 100 }]), opts).ok, true, 'control: a valid revoke');
  for (const [name, entries, why] of cases) assert.match(hist.verify(signed(entries), opts).because || '', why, name);
});

test('malformed entries are refused as not escrowd\'s form, never a throw', () => {
  const bad = [
    [{ kind: 'enrol', key: K1, at: NOW, backfill: 'yes' }],
    [{ kind: 'enrol', key: ATTACKER.toUpperCase(), at: NOW, backfill: false }],
    [{ kind: 'enrol', key: K1, at: -1, backfill: false }],
    [{ kind: 'enrol', key: K1, at: 1.5, backfill: false }],
    [{ kind: 'revoke', key: K1, at: NOW, backfill: false }],
    [{ kind: 'grant', key: K1, at: NOW }],
    [null],
  ];
  for (const entries of bad) {
    assert.strictEqual(hist.encodeHead('o1', 'm1', entries, NOW), null, JSON.stringify(entries));
    const r = hist.verify({ org: 'o1', member: 'm1', entries, issuedAt: NOW, signature: 'A'.repeat(86) }, opts);
    assert.match(r.because || '', /form escrowd signs/, JSON.stringify(entries));
  }
  for (const h of [null, undefined, 7, {}, { ...signed(BASE), signature: 'not base64url!' }]) assert.strictEqual(hist.verify(h, opts).ok, false);
});

test('keyAt honours the window edges: from is inclusive, until is exclusive', () => {
  const { keys } = hist.verify(signed(BASE), opts);
  assert.ok(hist.keyAt(keys, K1, NOW - 900));
  assert.strictEqual(hist.keyAt(keys, K1, NOW - 901), null);
  assert.ok(hist.keyAt(keys, K1, NOW - 501));
  assert.strictEqual(hist.keyAt(keys, K1, NOW - 500), null);
  assert.ok(hist.keyAt(keys, K2, NOW - 500));
});

const PINNED_HEAD_SHA256 = '90ab1cc201e136591c0e786dddc4a6e3e978febf875d1eeda9c1fa076793707a';
test('the signed head format is pinned, so the relay side (slice 2) can be checked against the same bytes', () => {
  const msg = hist.encodeHead('o1', 'm1', BASE, NOW - 60);
  assert.strictEqual(crypto.createHash('sha256').update(msg).digest('hex'), PINNED_HEAD_SHA256);
});

test('a clock that is not a time is refused by name, against an honest twin', () => {
  const h = signed(BASE);
  assert.strictEqual(hist.verify(h, opts).ok, true, 'control');
  for (const now of [0.5, -5, -1e9, '1800000000', null, NaN]) {
    assert.match(hist.verify(h, { ...opts, now }).because || '', /not a time/, String(now));
  }
});

test('the shipped verifying key, once it ships, is 32 bytes of lowercase hex (a bad paste fails here, not in a restore)', () => {
  assert.ok(hist.VERIFYING_KEY === null || /^[0-9a-f]{64}$/.test(hist.VERIFYING_KEY));
});

test('slice 2 interop: the exact JSON escrowd would send verifies, with a revoke whose backfill is null', () => {
  // Signed by the fixed seed [7; 32] (verification key below); Ed25519 is deterministic, so a Rust signer over the same
  // head must produce this signature byte for byte.
  assert.strictEqual(VK.toString('hex'), 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c');
  const wire = JSON.stringify({
    org: 'o1', member: 'm1', issuedAt: NOW - 60,
    entries: [
      { kind: 'enrol', key: K1, at: NOW - 900, backfill: true },
      { kind: 'revoke', key: K1, at: NOW - 500, backfill: null },
      { kind: 'enrol', key: K2, at: NOW - 500, backfill: false },
    ],
    signature: 'EOL_4FiyXjbfUroRJaVvDTIWU7aEaMs73hZFFrWqPY5ACMRZB4v2Isl1zBQFGujNBn2ytEziheXZEaWjqMU5AQ',
  });
  const r = hist.verify(JSON.parse(wire), opts);
  assert.strictEqual(r.ok, true, r.because);
  assert.strictEqual(r.keys.length, 2);
  const bad = JSON.parse(wire); bad.entries[1].backfill = false;
  assert.match(hist.verify(bad, opts).because, /form escrowd signs/, 'a revoke carrying a backfill value is not escrowd\'s form');
});

test('a caller can narrow the freshness window but never widen it', () => {
  const older = signed([{ ...BASE[0], at: NOW - 3 * 24 * 3600 }], { issuedAt: NOW - 2 * 24 * 3600 });
  assert.match(hist.verify(older, { ...opts, maxAgeSecs: 10 * 24 * 3600 }).because, /too old/);
  assert.match(hist.verify(signed(BASE, { issuedAt: NOW + 3600 }), { ...opts, skewSecs: 7200 }).because, /future/);
  assert.match(hist.verify(signed(BASE, { issuedAt: NOW - 450 }), { ...opts, maxAgeSecs: 300 }).because, /too old/, 'narrowing works');
  assert.strictEqual(hist.verify(signed(BASE, { issuedAt: NOW - 450 }), opts).ok, true, 'control: fresh at the default');
});

test('keyAt answers only for a key in the form the history holds it', () => {
  const { keys } = hist.verify(signed(BASE), opts);
  assert.ok(hist.keyAt(keys, K2, NOW - 100), 'control');
  assert.strictEqual(hist.keyAt(keys, 'AB'.repeat(32), NOW - 100), null);
  assert.strictEqual(hist.keyAt(keys, Buffer.from(K2, 'hex'), NOW - 100), null);
});
