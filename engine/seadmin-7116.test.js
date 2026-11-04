'use strict';

/**
 * kosmos#7116 slice 4, Mac half: engine/seadmin.js (what an se-p256 admin key may sign) and native-se/main.swift
 * (kosmos-se, the Secure Enclave signer).
 *
 * Part 1, everywhere: the encoders reproduce escrowd's pinned bytes and fingerprints (test-support/
 * escrowd-roster-vectors.json, the same file kosmos-relay's Rust test and console page test check); prepare() refuses
 * another action's bytes, a bare hash, and short or trailing bytes; kosmos-se's tag list equals SIGNED; the committed
 * Apple vectors verify here; and, with a stand-in helper, what createKey asks for and what sign does with a bad answer.
 * Part 2 needs macOS, swiftc and a Secure Enclave, and is skipped (said so) without them: build kosmos-se, make a key,
 * sign each pinned message, verify, and check the helper's own refusals. Where swiftc and an Enclave are there but the
 * build or the first key fails, Part 2's tests FAIL with that reason (Part 1 still runs): a broken main.swift must
 * never read as a skip.
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
  const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  for (const s of APPLE.signatures) {
    const der = hex(s.der), rLen = der[3], sLen = der[5 + rLen];
    const S = BigInt('0x' + der.subarray(6 + rLen, 6 + rLen + sLen).toString('hex'));
    assert.strictEqual(S > N / 2n, s.highS, `the highS flag of ${s.der.slice(0, 12)} is what its S says`);
    const msg = hex(V.bytes[s.message]);
    assert.ok(verifyDer(pub, msg, hex(s.der)), `${s.message} ${s.der.slice(0, 12)}`);
    const other = hex(V.bytes[s.message === 'cancel' ? 'changeAdd' : 'cancel']);
    assert.ok(!verifyDer(pub, other, hex(s.der)), 'the same signature over another message fails');
  }
});

// A stand-in for kosmos-se: records its arguments, prints a fixed public key, and answers sign with a signature made by
// a DIFFERENT key, so sign() must refuse it.
const FAKE_DIR = fs.existsSync('/bin/sh') ? fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-se-fake-7116-')) : null;
let FAKE = null;
const FAKE_PUB = Buffer.from(APPLE.key, 'hex');
if (FAKE_DIR) {
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const badSig = crypto.sign('sha256', hex(V.bytes.cancel), { key: other, dsaEncoding: 'der' }).toString('hex');
  FAKE = path.join(FAKE_DIR, 'fake-se');
  fs.writeFileSync(FAKE, `#!/bin/sh\necho "$@" >> "${FAKE_DIR}/argv"\ncat > "${FAKE_DIR}/stdin"\n` +
    `case "$1" in sign) echo ${badSig} ;; *) echo ${APPLE.key} ;; esac\n`, { mode: 0o755 });
}

test('#7116: createKey asks for a presence key unless a caller says presence: false', { skip: FAKE ? false : 'needs a POSIX shell' }, () => {
  const argv = path.join(FAKE_DIR, 'argv');
  fs.rmSync(argv, { force: true });
  assert.ok(se.createKey({ helper: FAKE, keyFile: '/k1' }).equals(FAKE_PUB));
  se.createKey({ helper: FAKE, keyFile: '/k2', presence: false });
  assert.deepStrictEqual(fs.readFileSync(argv, 'utf8').trim().split('\n'), ['create /k1 presence', 'create /k2 none']);
});

test('#7116: sign refuses a signature that does not verify under the helper\'s own key', { skip: FAKE ? false : 'needs a POSIX shell' }, () => {
  assert.throws(() => se.sign(se.prepare('cancel', hex(V.bytes.cancel)), { helper: FAKE, keyFile: '/k1', expectedKey: FAKE_PUB }), /does not verify/);
});

// Part 2: the real Enclave.
const swiftc = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { encoding: 'utf8' });
let HELPER = null, DIR = null, BROKEN = null;
let SKIP = process.platform !== 'darwin' ? 'needs macOS'
  : swiftc.status !== 0 ? 'needs swiftc (xcrun said: ' + String(swiftc.stderr || '').trim().split('\n')[0] + ')' : false;
const firstLine = (s) => String(s || '').trim().split('\n')[0];
if (!SKIP) {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-se-7116-'));
  HELPER = path.join(DIR, 'kosmos-se');
  const b = spawnSync('/usr/bin/xcrun', ['swiftc', '-O', path.join(ROOT, 'native-se/main.swift'), '-o', HELPER], { encoding: 'utf8' });
  if (b.status !== 0) BROKEN = 'kosmos-se did not build: ' + firstLine(b.stderr);
}
if (!SKIP && !BROKEN) {
  const probe = spawnSync(HELPER, ['create', path.join(DIR, 'probe'), 'none'], { encoding: 'utf8' });
  if (probe.status === 3) SKIP = 'this Mac has no Secure Enclave';
  // errSecInteractionNotAllowed (-25308): this SESSION cannot reach the Enclave (a runner started over ssh, with no
  // login session; measured on the kosmos-ci2 runner 11-03). Like "no Enclave", it says nothing about kosmos-se, so it
  // skips; every other create failure is still BROKEN and fails each test by name.
  else if (probe.status === 1 && /OSStatus error -25308\b/.test(String(probe.stderr))) SKIP = 'this session cannot use the Secure Enclave (OSStatus -25308: no login session)';
  else if (probe.status !== 0) BROKEN = 'kosmos-se create failed: ' + firstLine(probe.stderr);
}
// Run first in every Part 2 test, so a broken build or key fails each one by name rather than the whole file.
const whole = () => { if (BROKEN) assert.fail(BROKEN); };
test.after(() => {
  if (DIR) fs.rmSync(DIR, { recursive: true, force: true });
  if (FAKE_DIR) fs.rmSync(FAKE_DIR, { recursive: true, force: true });
});

test('#7116: a key made in the Enclave signs every pinned action, and the signature verifies under its own key only', { skip: SKIP }, () => {
  whole();
  const keyFile = path.join(DIR, 'admin');
  const pub = se.createKey({ helper: HELPER, keyFile, presence: false });
  assert.strictEqual(fs.statSync(keyFile).mode & 0o777, 0o600, 'the key file is 0600');
  assert.ok(pub.equals(se.publicKey({ helper: HELPER, keyFile })), 'pub reads back the key create printed');
  const otherPub = se.publicKey({ helper: HELPER, keyFile: path.join(DIR, 'probe') });
  for (const [name, action] of Object.entries(ACTION_OF)) {
    const msg = hex(V.bytes[name]);
    const callers = Buffer.from(msg);
    const shown = se.prepare(action, callers);
    callers.fill(0);                       // changed after the screen: the signature must still be over what was shown
    const der = se.sign(shown, { helper: HELPER, keyFile, expectedKey: pub });
    assert.ok(verifyDer(pub, msg, der), name);
    assert.ok(!verifyDer(otherPub, msg, der), `${name} under another key`);
  }
  // The same key file, but the screen expects the other key: refused before anything is signed.
  assert.throws(() => se.sign(se.prepare('cancel', hex(V.bytes.cancel)), { helper: HELPER, keyFile, expectedKey: otherPub }),
    /different key from the enrolled one/);
  assert.throws(() => se.sign(se.prepare('cancel', hex(V.bytes.cancel)), { helper: HELPER, keyFile }), /65 bytes/,
    'no expected key is a refusal, not a pass');
});

test('#7116: kosmos-se refuses to overwrite a key, and refuses bytes that are not an admin action even when called directly', { skip: SKIP }, () => {
  whole();
  const keyFile = path.join(DIR, 'probe');
  const before = fs.readFileSync(keyFile);
  assert.throws(() => se.createKey({ helper: HELPER, keyFile, presence: false }), /already exists/);
  assert.ok(fs.readFileSync(keyFile).equals(before), 'the existing key is untouched');
  const hash = crypto.createHash('sha256').update(hex(V.bytes.cancel)).digest();
  const direct = spawnSync(HELPER, ['sign', keyFile], { input: hash });
  assert.strictEqual(direct.status, 1);
  assert.match(direct.stderr.toString(), /not an escrowd admin action/);
  // Its passing twin: the same direct call with a pinned message signs.
  const ok = spawnSync(HELPER, ['sign', keyFile], { input: hex(V.bytes.cancel) });
  assert.strictEqual(ok.status, 0, ok.stderr.toString());
  // A message one byte over the cap is refused; the cap itself is not.
  const cap = 64 * 1024, tag = Buffer.from('kosmos-escrowd-roster-cancel v1');
  const at = Buffer.concat([tag, Buffer.alloc(cap - tag.length)]);
  assert.strictEqual(spawnSync(HELPER, ['sign', keyFile], { input: at }).status, 0, 'exactly the cap signs');
  const over = spawnSync(HELPER, ['sign', keyFile], { input: Buffer.concat([at, Buffer.of(0)]) });
  assert.strictEqual(over.status, 1);
  assert.match(over.stderr.toString(), /too long/);
  // And seadmin.sign signs nothing prepare() did not make, before the helper is ever asked.
  const dead = { helper: '/nonexistent/kosmos-se', keyFile };
  assert.throws(() => se.sign({ ...se.prepare('cancel', hex(V.bytes.cancel)) }, dead), /only what prepare returned/);
  assert.throws(() => se.sign(hex(V.bytes.cancel), dead), /only what prepare returned/);
});

test('#7116: kosmos-se refuses a key file that is readable by others, or is a symlink, and makes no key without a policy', { skip: SKIP }, () => {
  whole();
  const keyFile = path.join(DIR, 'probe');
  const loose = path.join(DIR, 'loose');
  fs.copyFileSync(keyFile, loose);
  fs.chmodSync(loose, 0o644);
  const r = spawnSync(HELPER, ['pub', loose]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr.toString(), /readable by others/);
  fs.chmodSync(loose, 0o600);
  assert.strictEqual(spawnSync(HELPER, ['pub', loose]).status, 0, 'the same file at 0600 opens');
  const link = path.join(DIR, 'link');
  fs.symlinkSync(keyFile, link);
  const viaLink = spawnSync(HELPER, ['pub', link]);
  assert.strictEqual(viaLink.status, 1);
  assert.match(viaLink.stderr.toString(), /not a plain file/);
  const bare = spawnSync(HELPER, ['create', path.join(DIR, 'nopolicy')]);
  assert.strictEqual(bare.status, 2);
  assert.ok(!fs.existsSync(path.join(DIR, 'nopolicy')), 'no key file was made');
});

test('#7116: a key made under a strict umask is still exactly 0600 and opens', { skip: SKIP }, () => {
  whole();
  const keyFile = path.join(DIR, 'umask');
  const r = spawnSync('/bin/sh', ['-c', 'umask 277 && exec "$0" create "$1" none', HELPER, keyFile]);
  assert.strictEqual(r.status, 0, r.stderr.toString());
  assert.strictEqual(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.strictEqual(spawnSync(HELPER, ['pub', keyFile]).status, 0);
});

test('#7116: sign signs the bytes prepare was given, not bytes changed afterwards, and prepare takes only bytes', () => {
  const bytes = Buffer.from(hex(V.bytes.cancel));
  const shown = se.prepare('cancel', bytes);
  bytes[bytes.length - 1] ^= 1;          // the caller changes its buffer after the screen was shown
  assert.ok(Object.isFrozen(shown));
  assert.throws(() => { shown.challenge = 'x'; }, TypeError);
  // What a screen reads is read again fresh: editing one read leaves the next, and the signed bytes, as prepared.
  const first = shown.decoded;
  first.org = 'someone else';
  first.id[0] ^= 1;
  assert.strictEqual(shown.decoded.org, V.org);
  assert.strictEqual(shown.decoded.id.toString('hex'), V.id);
  assert.strictEqual(shown.challenge, crypto.createHash('sha256').update(hex(V.bytes.cancel)).digest('hex'));
  if (FAKE) {
    // The stand-in records what it was handed: the bytes as shown, not the caller's changed buffer. (Its signature is
    // another key's, so sign then refuses it, after the helper was asked.)
    fs.rmSync(path.join(FAKE_DIR, 'stdin'), { force: true });
    assert.throws(() => se.sign(shown, { helper: FAKE, keyFile: '/k1', expectedKey: FAKE_PUB }), /does not verify/);
    assert.ok(fs.readFileSync(path.join(FAKE_DIR, 'stdin')).equals(hex(V.bytes.cancel)), 'the helper got the shown bytes');
  }
  for (const notBytes of ['kosmos-escrowd-roster-cancel v1', [1, 2], new ArrayBuffer(4)]) {
    assert.throws(() => se.prepare('cancel', notBytes), /are bytes/);
  }
});

test('#7892: prepare gives the screen escaped text, so hidden or look-alike characters cannot make two names look the same', () => {
  // The pinned vectors are plain text: shown matches decoded, and nothing is unusual.
  const plain = se.prepare('change', hex(V.bytes.changeAdd));
  assert.strictEqual(plain.shown.org, V.org);
  assert.strictEqual(plain.shown.change.admin.adminId, plain.decoded.change.admin.adminId);
  assert.strictEqual(plain.unusual, false, 'CONTROL: the pinned add reads as unusual');
  assert.ok(Object.isFrozen(plain.shown) && Object.isFrozen(plain.shown.change.admin), 'shown can be changed by a caller');
  assert.strictEqual(plain.shown.change.admin.key, undefined, 'bytes are shown as hex or fingerprints, never as text');

  const shownOrg = (org) => { const p = se.prepare('cancel', se.encodeCancel(org, 'roster-change', Buffer.alloc(16, 7))); return [p.shown.org, p.unusual]; };
  // A right-to-left override, a zero-width space, a BOM, a soft hyphen, a control character, a no-break space.
  for (const [org, want] of [
    ['Acme‮evil', 'Acme\\u{202E}evil'], ['Ac​me', 'Ac\\u{200B}me'], ['﻿Acme', '\\u{FEFF}Acme'],
    ['Ac­me', 'Ac\\u{00AD}me'], ['Acme\u0007', 'Acme\\u{0007}'], ['Acme Inc', 'Acme\\u{00A0}Inc'],
    ['Acme Inc', 'Acme\\u{2028}Inc'], ['Acme\u{E000}', 'Acme\\u{E000}'],
  ]) assert.deepStrictEqual(shownOrg(org), [want, true], JSON.stringify(org));
  // Two orgs that render the same raw are told apart once shown.
  assert.notStrictEqual(shownOrg('Acme')[0], shownOrg('Ac​me')[0]);
  // A name spelling an escape in plain letters cannot pass for a real escape.
  assert.deepStrictEqual(shownOrg('Acme\\u{202E}'), ['Acme\\\\u{202E}', false]);
  assert.notStrictEqual(shownOrg('Acme\\u{202E}')[0], shownOrg('Acme‮')[0]);
  // Look-alike letters: a Cyrillic a in a Latin name is kept as it is but marked.
  assert.deepStrictEqual(shownOrg('Acmе'), ['Acmе', true]);
  assert.deepStrictEqual(shownOrg('Αcme'), ['Αcme', true], 'a Greek capital alpha');
  // Ordinary names are not unusual: accents, one other script, Japanese's three scripts together, plain spaces.
  for (const org of ['Café Zürich', 'Москва ООО', '株式会社カオス', 'ひらがな会社', 'Acme Inc.', 'O\'Neil & Co'])
    assert.deepStrictEqual(shownOrg(org), [org, false], org);
});

test('#7892: nested decoded text is escaped too (an admin id and a reviewer name)', () => {
  const add = se.decodeChange(hex(V.bytes.changeAdd));
  const bytes = se.encodeChange(add.org, add.generation, { kind: 'add', admin: { ...add.change.admin, adminId: 'adm‮in' } }, add.nonce);
  const p = se.prepare('change', bytes);
  assert.strictEqual(p.shown.change.admin.adminId, 'adm\\u{202E}in');
  assert.strictEqual(p.unusual, true);
  assert.strictEqual(p.decoded.change.admin.adminId, 'adm‮in', 'the raw decode is unchanged: what is signed is the bytes');
});
