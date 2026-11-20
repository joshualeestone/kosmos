'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits

// kosmos#8768: a computer carried over at the switch-over (a backfill entry) is CONFIRMED by two admins enrolling the
// same key (devkey_enrol), which escrowd records as one more enrol of that key with backfill false. The replay
// accepts exactly that, and nothing else that repeats a key. Every refusal here has an honest twin that verifies.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const hist = require('./devkeyhist');

const NOW = 1_800_000_000;
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const escrowd = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.alloc(32, 9)]), format: 'der', type: 'pkcs8' });
const VK = crypto.createPublicKey(escrowd).export({ format: 'der', type: 'spki' }).subarray(-32);
const OLD = '33'.repeat(32);   // the carried-over computer
const NEW = '44'.repeat(32);   // a computer enrolled by admins from the start

function signed(entries, { org = 'o1', member = 'm1', issuedAt = NOW - 60 } = {}) {
  const msg = hist.encodeHead(org, member, entries, issuedAt);
  assert.ok(msg, 'fixture: the entries must be encodable');
  return { org, member, entries, issuedAt, signature: crypto.sign(null, msg, escrowd).toString('base64url') };
}
hist.setVerifyingKeyForTests(VK);
const opts = { now: NOW, org: 'o1', member: 'm1' };
const backfill = { kind: 'enrol', key: OLD, at: NOW - 900, backfill: true };
const confirm = { kind: 'enrol', key: OLD, at: NOW - 300, backfill: false };

test('#8768: a backfill confirmed by an admin enrol of the same key reads as admin-enrolled from its original time', () => {
  const out = hist.verify(signed([backfill, confirm]), opts);
  assert.strictEqual(out.ok, true, out.because);
  assert.deepStrictEqual(out.keys, [{ key: OLD, from: NOW - 900, until: null, backfill: false, confirmedAt: NOW - 300 }]);
  // The reader restore and hand-over use: the key at a time before the confirm is the same, admin-enrolled entry.
  const at = hist.keyAt(out.keys, OLD, NOW - 600);
  assert.strictEqual(at && at.backfill, false);
});

test('#8768 control: an unconfirmed backfill stays a backfill', () => {
  const out = hist.verify(signed([backfill]), opts);
  assert.strictEqual(out.ok, true, out.because);
  assert.strictEqual(out.keys[0].backfill, true);
  assert.strictEqual(out.keys[0].confirmedAt, undefined);
  assert.strictEqual(hist.keyAt(out.keys, OLD, NOW - 600).backfill, true);
});

test('#8768: a confirmed key can still be revoked, once', () => {
  const out = hist.verify(signed([backfill, confirm, { kind: 'revoke', key: OLD, at: NOW - 100 }]), opts);
  assert.strictEqual(out.ok, true, out.because);
  assert.strictEqual(out.keys[0].until, NOW - 100);
  assert.strictEqual(out.keys[0].backfill, false);
});

test('#8768: every other repeat of a key is still refused, each against the honest confirm', () => {
  const cases = [
    ['a second confirm', [backfill, confirm, { ...confirm, at: NOW - 200 }]],
    ['a confirm of a revoked backfill', [backfill, { kind: 'revoke', key: OLD, at: NOW - 500 }, confirm]],
    ['a backfill over a backfill', [backfill, { ...backfill, at: NOW - 300 }]],
    ['a backfill over an admin-enrolled key', [{ ...confirm, key: NEW, at: NOW - 900 }, { kind: 'enrol', key: NEW, at: NOW - 300, backfill: true }]],
    ['an admin enrol over an admin-enrolled key', [{ ...confirm, key: NEW, at: NOW - 900 }, { ...confirm, key: NEW, at: NOW - 300 }]],
    ['a backfill over a confirmed key', [backfill, confirm, { ...backfill, at: NOW - 200 }]],
  ];
  assert.strictEqual(hist.verify(signed([backfill, confirm]), opts).ok, true, 'control: the honest confirm');
  for (const [name, entries] of cases) assert.match(hist.verify(signed(entries), opts).because || '', /enrols the same key twice/, name);
});

test('#8768 interop: the confirm history\'s head is pinned on both sides (kosmos-relay devkeyhist.rs the_macs_confirm_vector_is_reproduced)', () => {
  const entries = [{ kind: 'enrol', key: OLD, at: NOW - 900, backfill: true }, { kind: 'enrol', key: OLD, at: NOW - 300, backfill: false }];
  const msg = hist.encodeHead('o1', 'm1', entries, NOW - 60);
  assert.strictEqual(crypto.createHash('sha256').update(msg).digest('hex'), '6967f73b184cfb3cbd4dff3992357d07f2a3befc7f13dea013b14a98097e1046');
});
