'use strict';

/**
 * kosmos#7116 slice 4, Mac half: engine/seadmin.js (what an se-p256 admin key may sign) and native-se/main.swift
 * (kosmos-se, the Secure Enclave signer).
 *
 * Part 1, everywhere: the encoders reproduce escrowd's pinned bytes and fingerprints (test-support/
 * escrowd-roster-vectors.json, the same file kosmos-relay's Rust test and console page test check); prepare() refuses
 * another action's bytes, a bare hash, and short or trailing bytes; kosmos-se's tag list equals SIGNED; the committed
 * Apple vectors verify here. Part 2 needs macOS, swiftc and a Secure Enclave, and is skipped (said so) without them:
 * build kosmos-se, make a key, sign each pinned message, verify, and check the helper's own refusals.
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const se = require('./seadmin');

const ROOT = path.join(__dirname, '..');
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-support/escrowd-roster-vectors.json'), 'utf8'));
const APPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-support/se-p256-apple-vectors.json'), 'utf8'));
const hex = (s) => Buffer.from(s, 'hex');
const admin = { ...V.admin, key: hex(V.admin.key), credentialId: hex(V.admin.credentialId) };
const reviewer = { ...V.reviewer, key: hex(V.reviewer.key), credentialId: hex(V.reviewer.credentialId) };
const nonce = hex(V.nonce);
const ACTION_OF = { changeAdd: 'change', changeRemove: 'change', cancel: 'cancel', reviewerEnrol: 'reviewerEnrol',
  reviewerRevoke: 'reviewerRevoke' };

function p256Key(sec1) {
  return crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: sec1.subarray(1, 33).toString('base64url'),
    y: sec1.subarray(33, 65).toString('base64url') }, format: 'jwk' });
}
const verifyDer = (pub, msg, der) => crypto.verify('sha256', msg, { key: p256Key(pub), dsaEncoding: 'der' }, der);

test('#7116: every encoder reproduces escrowd\'s pinned bytes, and the fingerprints match', () => {
  assert.strictEqual(V.bytes ? Object.keys(V.bytes).length : 0, 5, 'the vector file has the five byte strings');
  assert.strictEqual(se.encodeChange(V.org, V.generation, { kind: 'add', admin }, nonce).toString('hex'), V.bytes.changeAdd);
  assert.strictEqual(se.encodeChange(V.org, V.generation,
    { kind: 'remove', adminId: V.remove.adminId, keyHash: hex(V.remove.keyHash) }, nonce).toString('hex'), V.bytes.changeRemove);
  assert.strictEqual(se.encodeCancel(V.org, 'roster-change', hex(V.id)).toString('hex'), V.bytes.cancel);
  assert.strictEqual(se.encodeReviewerEnrol(V.org, V.generation, reviewer, nonce).toString('hex'), V.bytes.reviewerEnrol);
  assert.strictEqual(se.encodeReviewerRevoke(V.org, reviewer.credentialId).toString('hex'), V.bytes.reviewerRevoke);
  assert.strictEqual(se.fingerprintDisplay(se.adminFingerprint(V.org, admin)), V.fingerprints.admin);
  assert.strictEqual(se.fingerprintDisplay(se.reviewerFingerprint(V.org, reviewer)), V.fingerprints.reviewer);
});

test('#7116: prepare decodes each pinned action, shows the fingerprint from the decoded bytes, and computes the challenge itself', () => {
  for (const [name, action] of Object.entries(ACTION_OF)) {
    const bytes = hex(V.bytes[name]);
    const p = se.prepare(action, bytes);
    assert.strictEqual(p.challenge, crypto.createHash('sha256').update(bytes).digest('hex'), name);
    assert.strictEqual(p.decoded.org, V.org, name);
  }
  assert.strictEqual(se.prepare('change', hex(V.bytes.changeAdd)).fingerprint, V.fingerprints.admin);
  assert.strictEqual(se.prepare('reviewerEnrol', hex(V.bytes.reviewerEnrol)).fingerprint, V.fingerprints.reviewer);
  assert.strictEqual(se.prepare('change', hex(V.bytes.changeRemove)).fingerprint, null, 'a removal names no new key');
  assert.strictEqual(se.prepare('change', hex(V.bytes.changeAdd)).decoded.generation, BigInt(V.generation));
});

test('#7116: another action\'s bytes, a bare hash, a fingerprint input, short and trailing bytes are all refused', () => {
  for (const [name, own] of Object.entries(ACTION_OF)) {
    const bytes = hex(V.bytes[name]);
    for (const action of se.SIGNED) {
      if (action === own) continue;
      assert.throws(() => se.prepare(action, bytes), /different action/, `${name} as ${action}`);
    }
    assert.throws(() => se.prepare(own, Buffer.concat([bytes, Buffer.of(0)])), /left over/, `${name} + a byte`);
    assert.throws(() => se.prepare(own, bytes.subarray(0, bytes.length - 1)), /end early/, `${name} - a byte`);
    // The passing twin of the two above, so a refusal is the change and not the input.
    assert.doesNotThrow(() => se.prepare(own, bytes), name);
  }
  const hash = crypto.createHash('sha256').update(hex(V.bytes.cancel)).digest();
  for (const action of se.SIGNED) assert.throws(() => se.prepare(action, hash), /different action/, `hash as ${action}`);
  assert.throws(() => se.prepare('adminFingerprint', hex(V.bytes.cancel)), /not an action/);
  assert.throws(() => se.prepare('cancel', 'kosmos-escrowd-roster-cancel v1'), /are bytes/, 'a string is not bytes');
  // A passkey add without a credential id, and an se-p256 add with one, are malformed adds.
  const seAdd = { ...admin, keyType: 'se-p256' };
  assert.throws(() => se.prepare('change', se.encodeChange(V.org, 1, { kind: 'add', admin: seAdd }, nonce)), /only a passkey/);
  const seAddOk = { ...seAdd, credentialId: Buffer.alloc(0) };
  assert.doesNotThrow(() => se.prepare('change', se.encodeChange(V.org, 1, { kind: 'add', admin: seAddOk }, nonce)));
});

test('#7116: kosmos-se\'s own tag fence is exactly the tags seadmin.js signs', () => {
  const swift = fs.readFileSync(path.join(ROOT, 'native-se/main.swift'), 'utf8');
  const block = swift.match(/let SIGNABLE_TAGS: \[String\] = \[([\s\S]*?)\]/);
  assert.ok(block, 'SIGNABLE_TAGS is in main.swift');
  const inSwift = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(inSwift, se.SIGNED.map((a) => se.TAGS[a]).sort());
  assert.ok(!inSwift.some((t) => /fingerprint/.test(t)), 'a fingerprint tag is a hash input, never signed');
});

test('#7116: the committed Apple Secure Enclave signatures verify over their pinned messages, high-S ones included', () => {
  const pub = hex(APPLE.key);
  assert.ok(APPLE.signatures.length >= 2 && APPLE.signatures.some((s) => s.highS), 'the file carries a high-S signature');
  for (const s of APPLE.signatures) {
    const msg = hex(V.bytes[s.message]);
    assert.ok(verifyDer(pub, msg, hex(s.der)), `${s.message} ${s.der.slice(0, 12)}`);
    const other = hex(V.bytes[s.message === 'cancel' ? 'changeAdd' : 'cancel']);
    assert.ok(!verifyDer(pub, other, hex(s.der)), 'the same signature over another message fails');
  }
});

// Part 2: the real Enclave.
const swiftc = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
const CAN_BUILD = process.platform === 'darwin' && swiftc.status === 0;
let HELPER = null, DIR = null, SKIP = CAN_BUILD ? false : 'needs macOS and swiftc';
if (CAN_BUILD) {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-se-7116-'));
  HELPER = path.join(DIR, 'kosmos-se');
  const b = spawnSync('/usr/bin/xcrun', ['swiftc', '-O', path.join(ROOT, 'native-se/main.swift'), '-o', HELPER], { encoding: 'utf8' });
  if (b.status !== 0) throw new Error('kosmos-se did not build: ' + b.stderr);
  const probe = spawnSync(HELPER, ['create', path.join(DIR, 'probe')], { encoding: 'utf8' });
  if (probe.status === 3) SKIP = 'this Mac has no Secure Enclave';
  else if (probe.status !== 0) throw new Error('kosmos-se create failed: ' + probe.stderr);
}
test.after(() => { if (DIR) fs.rmSync(DIR, { recursive: true, force: true }); });

test('#7116: a key made in the Enclave signs every pinned action, and the signature verifies under its own key only', { skip: SKIP }, () => {
  const keyFile = path.join(DIR, 'admin');
  const pub = se.createKey({ helper: HELPER, keyFile });
  assert.strictEqual(fs.statSync(keyFile).mode & 0o777, 0o600, 'the key file is 0600');
  assert.ok(pub.equals(se.publicKey({ helper: HELPER, keyFile })), 'pub reads back the key create printed');
  const otherPub = se.publicKey({ helper: HELPER, keyFile: path.join(DIR, 'probe') });
  for (const [name, action] of Object.entries(ACTION_OF)) {
    const msg = hex(V.bytes[name]);
    const der = se.sign(action, msg, { helper: HELPER, keyFile });
    assert.ok(verifyDer(pub, msg, der), name);
    assert.ok(!verifyDer(otherPub, msg, der), `${name} under another key`);
  }
});

test('#7116: kosmos-se refuses to overwrite a key, and refuses bytes that are not an admin action even when called directly', { skip: SKIP }, () => {
  const keyFile = path.join(DIR, 'probe');
  const before = fs.readFileSync(keyFile);
  assert.throws(() => se.createKey({ helper: HELPER, keyFile }), /already exists/);
  assert.ok(fs.readFileSync(keyFile).equals(before), 'the existing key is untouched');
  const hash = crypto.createHash('sha256').update(hex(V.bytes.cancel)).digest();
  const direct = spawnSync(HELPER, ['sign', keyFile], { input: hash });
  assert.strictEqual(direct.status, 1);
  assert.match(direct.stderr.toString(), /not an escrowd admin action/);
  // Its passing twin: the same direct call with a pinned message signs.
  const ok = spawnSync(HELPER, ['sign', keyFile], { input: hex(V.bytes.cancel) });
  assert.strictEqual(ok.status, 0, ok.stderr.toString());
  // And seadmin.sign stops another action's bytes before the helper is ever asked.
  assert.throws(() => se.sign('reviewerRevoke', hex(V.bytes.cancel), { helper: '/nonexistent/kosmos-se', keyFile }), /different action/);
});
