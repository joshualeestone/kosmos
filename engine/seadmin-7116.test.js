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

test('#7116: createKey asks for a presence key unless a caller says presence: false', { skip: FAKE ? false : 'needs a POSIX shell' }, async () => {
  const argv = path.join(FAKE_DIR, 'argv');
  fs.rmSync(argv, { force: true });
  assert.ok((await se.createKey({ helper: FAKE, keyFile: '/k1' })).equals(FAKE_PUB));
  await se.createKey({ helper: FAKE, keyFile: '/k2', presence: false });
  assert.deepStrictEqual(fs.readFileSync(argv, 'utf8').trim().split('\n'), ['create /k1 presence', 'create /k2 none']);
});

test('#7116: sign refuses a signature that does not verify under the helper\'s own key', { skip: FAKE ? false : 'needs a POSIX shell' }, async () => {
  await assert.rejects(se.sign(se.prepare('cancel', hex(V.bytes.cancel)), { helper: FAKE, keyFile: '/k1', expectedKey: FAKE_PUB }), /does not verify/);
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

test('#7116: a key made in the Enclave signs every pinned action, and the signature verifies under its own key only', { skip: SKIP }, async () => {
  whole();
  const keyFile = path.join(DIR, 'admin');
  const pub = await se.createKey({ helper: HELPER, keyFile, presence: false });
  assert.strictEqual(fs.statSync(keyFile).mode & 0o777, 0o600, 'the key file is 0600');
  assert.ok(pub.equals(await se.publicKey({ helper: HELPER, keyFile })), 'pub reads back the key create printed');
  const otherPub = await se.publicKey({ helper: HELPER, keyFile: path.join(DIR, 'probe') });
  for (const [name, action] of Object.entries(ACTION_OF)) {
    const msg = hex(V.bytes[name]);
    const callers = Buffer.from(msg);
    const shown = se.prepare(action, callers);
    callers.fill(0);                       // changed after the screen: the signature must still be over what was shown
    const der = await se.sign(shown, { helper: HELPER, keyFile, expectedKey: pub });
    assert.ok(verifyDer(pub, msg, der), name);
    assert.ok(!verifyDer(otherPub, msg, der), `${name} under another key`);
  }
  // The same key file, but the screen expects the other key: refused before anything is signed.
  await assert.rejects(se.sign(se.prepare('cancel', hex(V.bytes.cancel)), { helper: HELPER, keyFile, expectedKey: otherPub }),
    /different key from the enrolled one/);
  await assert.rejects(se.sign(se.prepare('cancel', hex(V.bytes.cancel)), { helper: HELPER, keyFile }), /65 bytes/,
    'no expected key is a refusal, not a pass');
});

test('#7116: kosmos-se refuses to overwrite a key, and refuses bytes that are not an admin action even when called directly', { skip: SKIP }, async () => {
  whole();
  const keyFile = path.join(DIR, 'probe');
  const before = fs.readFileSync(keyFile);
  await assert.rejects(se.createKey({ helper: HELPER, keyFile, presence: false }), (e) => e.message === 'the key file already exists',
    'the helper\'s refusal reaches the caller as its own fixed sentence, nothing more');
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
  await assert.rejects(se.sign({ ...se.prepare('cancel', hex(V.bytes.cancel)) }, dead), /only what prepare returned/);
  await assert.rejects(se.sign(hex(V.bytes.cancel), dead), /only what prepare returned/);
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

test('#7116: sign signs the bytes prepare was given, not bytes changed afterwards, and prepare takes only bytes', async () => {
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
    await assert.rejects(se.sign(shown, { helper: FAKE, keyFile: '/k1', expectedKey: FAKE_PUB }), /does not verify/);
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
    ['Acme\u202Eevil', 'Acme\\u{202E}evil'], ['Ac\u200Bme', 'Ac\\u{200B}me'], ['\uFEFFAcme', '\\u{FEFF}Acme'],
    ['Ac\u00ADme', 'Ac\\u{00AD}me'], ['Acme\u0007', 'Acme\\u{0007}'], ['Acme\u00A0Inc', 'Acme\\u{00A0}Inc'],
    ['Acme\u2028Inc', 'Acme\\u{2028}Inc'], ['Acme\u{E000}', 'Acme\\u{E000}'],
    // Invisible marks and letters (default-ignorable): a variation selector, the combining grapheme joiner, a Hangul
    // filler inside a Hangul name (where the script rule alone would not mark it).
    ['Acme\uFE0F', 'Acme\\u{FE0F}'], ['Ac\u034Fme', 'Ac\\u{034F}me'], ['\uAC00\u3164\uB098', '\uAC00\\u{3164}\uB098'],
  ]) assert.deepStrictEqual(shownOrg(org), [want, true], JSON.stringify(org));
  // The same letters in two Unicode forms: a combining accent is marked, the precomposed one is not.
  assert.deepStrictEqual(shownOrg('Cafe\u0301'), ['Cafe\u0301', true], 'a decomposed accent');
  assert.deepStrictEqual(shownOrg('Caf\u00E9'), ['Caf\u00E9', false], 'CONTROL: the composed form');
  // Characters that draw as a blank or a box are escaped (braille blank, object replacement, replacement character).
  for (const [org, want] of [['Acme\u2800', 'Acme\\u{2800}'], ['\uFFFCAcme', '\\u{FFFC}Acme'], ['Ac\uFFFDme', 'Ac\\u{FFFD}me']])
    assert.deepStrictEqual(shownOrg(org), [want, true], JSON.stringify(org));
  // Spaces that do not show: at the start, at the end, or a second in a row. One space between words is the control.
  for (const [org, want] of [['Acme ', 'Acme\\u{0020}'], [' Acme', '\\u{0020}Acme'], ['Acme  Inc', 'Acme \\u{0020}Inc']])
    assert.deepStrictEqual(shownOrg(org), [want, true], JSON.stringify(org));
  assert.deepStrictEqual(shownOrg('Acme Inc'), ['Acme Inc', false], 'CONTROL: one space between words');
  // Letters of the Common script (the Japanese long-vowel mark, the Arabic tatweel) are no one script's, so they do not
  // make an ordinary name read as mixed.
  for (const org of ['コーヒー株式会社', 'اـل'])
    assert.deepStrictEqual(shownOrg(org), [org, false], JSON.stringify(org));
  // Marks that NFC leaves alone but that draw over, around or without a letter: an overlay ("o" + U+0338 draws like
  // "ø"), an enclosing circle, a mark at the start, a mark after a space.
  for (const org of ['Bjo̸rn', 'o⃒', 'o⃘', 'Ac⃝me', '́Acme', 'Acme ́Inc', 'Acme-́Inc']) {
    assert.strictEqual(org.normalize('NFC'), org, 'CONTROL: NFC leaves ' + JSON.stringify(org) + ' alone');
    assert.strictEqual(shownOrg(org)[1], true, JSON.stringify(org));
  }
  // Fullwidth letters look like ASCII ones and change under NFKC: kept as they are, but marked.
  assert.deepStrictEqual(shownOrg('\uFF21BC'), ['\uFF21BC', true], 'fullwidth A');
  // A stack of three combining marks is marked even where NFC leaves it alone; two (as in Devanagari) are not.
  const stack = 'x\u0301\u0302\u0303';
  assert.strictEqual(stack.normalize('NFC'), stack, 'CONTROL: NFC leaves this stack alone, so only the mark rule can catch it');
  assert.strictEqual(shownOrg(stack)[1], true, 'three marks');
  assert.deepStrictEqual(shownOrg('\u0915\u093F\u0902'), ['\u0915\u093F\u0902', false], 'CONTROL: two marks in Devanagari');
  // Latin with Han, Katakana or Hangul is how East Asian companies write their names: not marked (a decision, pinned).
  // Symbols and punctuation that NFKC changes (a trademark sign, the fullwidth brackets of "(\u682A)") are not marked
  // either; a fullwidth LETTER is (above).
  for (const org of ['Kosmos \u682A\u5F0F\u4F1A\u793E', 'NTT\u30C7\u30FC\u30BF', 'Acme\u2122', '\uFF08\u682A\uFF09\u30AB\u30AA\u30B9', '\u3231\u30AB\u30AA\u30B9'])
    assert.deepStrictEqual(shownOrg(org), [org, false], JSON.stringify(org));
  // Digits from another script count toward mixing: Devanagari zeros in "Google" are marked; plain "Google" is not.
  assert.deepStrictEqual(shownOrg('G\u0966\u0966gle'), ['G\u0966\u0966gle', true], 'Devanagari zeros');
  assert.deepStrictEqual(shownOrg('Acme\u0660'), ['Acme\u0660', true], 'an Arabic-Indic zero');
  assert.deepStrictEqual(shownOrg('Google'), ['Google', false], 'CONTROL: ASCII digits and letters');
  assert.deepStrictEqual(shownOrg('Acme 2026'), ['Acme 2026', false], 'CONTROL: ASCII digits are no script');
  // Cyrillic with Han is still two scripts.
  assert.strictEqual(shownOrg('\u0410\u682A')[1], true, 'Cyrillic with Han');
  // Two orgs that render the same raw are told apart once shown.
  assert.notStrictEqual(shownOrg('Acme')[0], shownOrg('Ac\u200Bme')[0]);
  // A name spelling an escape in plain letters cannot pass for a real escape.
  assert.deepStrictEqual(shownOrg('Acme\\u{202E}'), ['Acme\\\\u{202E}', false]);
  assert.notStrictEqual(shownOrg('Acme\\u{202E}')[0], shownOrg('Acme\u202E')[0]);
  // Look-alike letters: a Cyrillic a in a Latin name is kept as it is but marked.
  assert.deepStrictEqual(shownOrg('Acmе'), ['Acmе', true]);
  assert.deepStrictEqual(shownOrg('Αcme'), ['Αcme', true], 'a Greek capital alpha');
  // Ordinary names are not unusual: accents, one other script, Japanese's three scripts together, plain spaces.
  for (const org of ['Café Zürich', 'Москва ООО', '株式会社カオス', 'ひらがな会社', 'Acme Inc.', 'O\'Neil & Co'])
    assert.deepStrictEqual(shownOrg(org), [org, false], org);
});

test('#7892: nested decoded text is escaped too (an admin id and a reviewer name)', () => {
  const add = se.decodeChange(hex(V.bytes.changeAdd));
  const bytes = se.encodeChange(add.org, add.generation, { kind: 'add', admin: { ...add.change.admin, adminId: 'adm\u202Ein' } }, add.nonce);
  const p = se.prepare('change', bytes);
  assert.strictEqual(p.shown.change.admin.adminId, 'adm\\u{202E}in');
  assert.strictEqual(p.unusual, true);
  assert.strictEqual(p.decoded.change.admin.adminId, 'adm\u202Ein', 'the raw decode is unchanged: what is signed is the bytes');
});

test('#7892: every refusal kosmos-se can write is on the list a screen may show, and nothing else is', () => {
  const swift = fs.readFileSync(path.join(ROOT, 'native-se/main.swift'), 'utf8');
  const literal = [...swift.matchAll(/fail\("((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\\(.*\)$/, '').replace(/ \($/, '').trim());
  const ternary = [...swift.matchAll(/\? "([^"]+)" : "([^"]+)"/g)].flatMap((m) => [m[1], m[2]]);
  const said = new Set([...literal, ...ternary]);
  // Every fail( argument is a literal, a literal ternary, or `usage`, so the two lists above see every refusal.
  const args = [...swift.matchAll(/(?<!func )\bfail\(\s*([^"\s][^,)]*)/g)].map((m) => m[1].trim());
  assert.ok(swift.includes('fail(usage, 2)'), 'CONTROL: the usage call is where this test expects it');
  assert.deepStrictEqual([...new Set(args)].filter((a) => a !== 'usage' && !/^[^?]+\?\s*"/.test(a)), [], 'a fail() whose argument the lists cannot read');
  assert.ok(said.size >= 10, 'CONTROL: found only ' + said.size + ' refusals in main.swift');
  const listed = new Set([...se.HELPER_SAYS, ...se.HELPER_SAYS_PREFIX]);
  assert.deepStrictEqual([...said].filter((w) => !listed.has(w)).sort(), [], 'kosmos-se writes a refusal the list does not have');
  assert.deepStrictEqual([...listed].filter((w) => !said.has(w)).sort(), [], 'the list has a refusal kosmos-se never writes');
});

test('#7892: a helper failure reaches the caller as a fixed sentence, never its path, argv or stderr', { skip: FAKE ? false : 'needs a POSIX shell' }, async () => {
  const say = (body) => { const f = path.join(FAKE_DIR, 'say-' + crypto.randomBytes(4).toString('hex')); fs.writeFileSync(f, '#!/bin/sh\n' + body + '\n', { mode: 0o755 }); return f; };
  const secret = '/Users/someone/Library/secret-key-file';
  // A listed refusal: exactly its sentence.
  await assert.rejects(se.publicKey({ helper: say('echo "kosmos-se: the key file belongs to someone else" >&2; exit 1'), keyFile: secret }),
    (e) => e.message === 'the key file belongs to someone else');
  // The one with a variable tail: only its fixed start.
  await assert.rejects(se.createKey({ helper: say('echo "kosmos-se: the Secure Enclave refused to make a key (' + secret + ')" >&2; exit 1'), keyFile: secret }),
    (e) => e.message === 'the Secure Enclave refused to make a key');
  // Anything else: the generic sentence, with nothing of the path, the argv or the stderr.
  for (const body of ['echo "' + secret + ' exploded" >&2; exit 1', 'echo "kosmos-se: ' + secret + '" >&2; exit 4', 'exit 1', 'kill -9 $$']) {
    await assert.rejects(se.publicKey({ helper: say(body), keyFile: secret }), (e) => {
      assert.strictEqual(e.message, 'the admin key helper failed', body);
      return true;
    });
  }
  // A helper that is there but cannot be run (not executable), and one that floods its output past the buffer: each its
  // own sentence, and neither reads as a timeout.
  const noExec = path.join(FAKE_DIR, 'no-exec-se'); fs.writeFileSync(noExec, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
  await assert.rejects(se.publicKey({ helper: noExec, keyFile: secret }), (e) => e.message === 'the admin key helper cannot be run');
  await assert.rejects(se.publicKey({ helper: say('head -c 70000 /dev/zero | tr "\\0" x >&2; exit 1'), keyFile: secret }),
    (e) => e.message === 'the admin key helper failed');
  // An argument execFile itself refuses (a NUL in the key path) throws with the argument in its message: generic.
  await assert.rejects(se.publicKey({ helper: FAKE, keyFile: secret + '\u0000k' }), (e) => e.message === 'the admin key helper failed');
  // A helper that is not there: named as not installed, without its path.
  await assert.rejects(se.publicKey({ helper: path.join(FAKE_DIR, 'no-such-helper'), keyFile: secret }),
    (e) => e.message === 'the admin key helper is not installed');
  // CONTROL: a helper that answers well still works through the same call.
  assert.ok((await se.publicKey({ helper: FAKE, keyFile: '/k1' })).equals(FAKE_PUB));
});

test('#7892: signing does not hold the event loop while the helper waits (a presence key waits on the person)', { skip: FAKE ? false : 'needs a POSIX shell' }, async () => {
  const slow = path.join(FAKE_DIR, 'slow-se');
  fs.writeFileSync(slow, '#!/bin/sh\nsleep 0.4\necho ' + APPLE.key + '\n', { mode: 0o755 });
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 20);
  try {
    const t0 = Date.now();
    const pub = await se.publicKey({ helper: slow, keyFile: '/k1' });
    assert.ok(Date.now() - t0 >= 350, 'CONTROL: the stand-in did not wait');
    assert.ok(pub.equals(FAKE_PUB));
    assert.ok(ticks >= 5, 'the event loop ran ' + ticks + ' times in 400 ms of helper time');
  } finally { clearInterval(timer); }
});

test('#7892: every tag kosmos-se signs has a prompt reason, chosen from the tag and not from an argument', () => {
  const swift = fs.readFileSync(path.join(ROOT, 'native-se/main.swift'), 'utf8');
  const at = swift.indexOf('= [', swift.indexOf('let SIGN_REASONS'));
  const table = swift.slice(at, swift.indexOf('\n]', at));
  assert.ok(table.length > 20, 'CONTROL: SIGN_REASONS not found');
  const reasons = Object.fromEntries([...table.matchAll(/"([^"]+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepStrictEqual(Object.keys(reasons).sort(), se.SIGNED.map((a) => se.TAGS[a]).sort(), 'a signed tag has no prompt reason, or a reason names no signed tag');
  for (const r of Object.values(reasons)) assert.match(r, /^[a-z][A-Za-z' ]+$/, 'a reason does not read as "kosmos-se is trying to ' + r + '"');
  assert.match(swift, /context\.localizedReason = reason/, 'the reason is not given to the signature\'s context');
  // One cancel tag covers both kinds of pending item, so its reason must name both, or half the prompts are wrong.
  const cancelReason = reasons[se.TAGS.cancel];
  for (const word of ['admins', 'reviewers']) assert.ok(cancelReason.includes(word), 'the cancel prompt does not name ' + word);
  assert.doesNotMatch(swift, /localizedReason = .*args/, 'the reason comes from an argument');
});

test('#7892: two signs asked for at once run one after the other, so two prompts are never up together', { skip: FAKE ? false : 'needs a POSIX shell' }, async () => {
  const log = path.join(FAKE_DIR, 'serial.log');
  fs.rmSync(log, { force: true });
  const slow = path.join(FAKE_DIR, 'serial-se');
  fs.writeFileSync(slow, '#!/bin/sh\ncase "$1" in\n  pub) echo ' + APPLE.key + ' ;;\n' +
    '  sign) cat > /dev/null; echo start >> "' + log + '"; sleep 0.3; echo end >> "' + log + '"; echo 3006020101020101 ;;\nesac\n', { mode: 0o755 });
  const opts = { helper: slow, keyFile: '/k1', expectedKey: FAKE_PUB };
  // Both reject (the stand-in's signature is not a real one); what matters is the order the helper saw.
  const both = await Promise.allSettled([se.sign(se.prepare('cancel', hex(V.bytes.cancel)), opts),
    se.sign(se.prepare('cancel', hex(V.bytes.cancel)), opts)]);
  assert.deepStrictEqual(both.map((r) => r.status), ['rejected', 'rejected']);
  assert.deepStrictEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['start', 'end', 'start', 'end'],
    'the second signature began before the first ended');
  // A failed sign does not stall the queue: a third one still runs.
  await assert.rejects(se.sign(se.prepare('cancel', hex(V.bytes.cancel)), opts));
  assert.strictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').length, 6);
});

test('#7892: a zero-width joiner or non-joiner inside a Persian or Indic word is spelling, kept and not marked', () => {
  const shownOrg = (org) => { const p = se.prepare('cancel', se.encodeCancel(org, 'roster-change', Buffer.alloc(16, 7))); return [p.shown.org, p.unusual]; };
  // Persian "mi" + ZWNJ + "khaham", and Hindi ka + virama + ZWJ + ssa (a half form): as they are, not marked.
  for (const org of ['\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645', '\u0915\u094D\u200D\u0937'])
    assert.deepStrictEqual(shownOrg(org), [org, false], JSON.stringify(org));
  // Everywhere else it is still escaped and marked: in a Latin name, between two scripts, at either end of a word,
  // and between letters of a script that does not join.
  for (const [org, want] of [
    ['Ac\u200Cme', 'Ac\\u{200C}me'],
    ['\u0645\u200CA', '\u0645\\u{200C}A'],
    ['\u0645\u06CC\u200C', '\u0645\u06CC\\u{200C}'],
    ['\u200C\u0645\u06CC', '\\u{200C}\u0645\u06CC'],
    ['\u0410\u200D\u0411', '\u0410\\u{200D}\u0411'],
    // Joiners that change nothing on screen (IDNA ContextJ): after an alef, which never joins forward; a ZWJ between
    // Arabic letters, which join anyway; an Indic joiner with no virama.
    ['\u0627\u200C\u0628', '\u0627\\u{200C}\u0628'],
    ['\u0628\u200D\u0628', '\u0628\\u{200D}\u0628'],
    ['\u0915\u200C\u0937', '\u0915\\u{200C}\u0937'],
    ['\u0915\u200D\u0937', '\u0915\\u{200D}\u0937'],
    // Two joining scripts either side, and a virama of another script.
    ['\u0645\u200C\u0915', '\u0645\\u{200C}\u0915'],
    ['\u0645\u094D\u200D\u06CC', '\u0645\u094D\\u{200D}\u06CC'],
    // A tatweel either side (Joining_Type C, not D); dal before (R: never joins forward); a ZWNJ then a ZWJ; a virama
    // at the very start; Tamil, which has no half forms.
    ['\u0628\u0640\u200C\u0628', '\u0628\u0640\\u{200C}\u0628'],
    ['\u0628\u200C\u0640\u0628', '\u0628\\u{200C}\u0640\u0628'],
    ['\u062F\u200C\u0628', '\u062F\\u{200C}\u0628'],
    ['\u0628\u200C\u200D\u0628', '\u0628\\u{200C}\\u{200D}\u0628'],
    ['\u094D\u200D\u0937', '\u094D\\u{200D}\u0937'],
    ['\u0B95\u0BCD\u200D\u0BB7', '\u0B95\u0BCD\\u{200D}\u0BB7'],
    // One letter from each R group before a ZWNJ (each never joins forward, so the ZWNJ changes nothing).
    ['\u0691\u200C\u0628', '\u0691\\u{200C}\u0628'],
    ['\u06C4\u200C\u0628', '\u06C4\\u{200C}\u0628'],
    ['\u075B\u200C\u0628', '\u075B\\u{200C}\u0628'],
  ]) assert.deepStrictEqual(shownOrg(org), [want, true], JSON.stringify(org));
  // The kept joiner per script (VIRAMAS): a ZWJ half form where the script has them (Gujarati, Malayalam, Sinhala;
  // Devanagari and Bengali above), a ZWNJ where a ZWJ asks for almost nothing (Gurmukhi, Oriya, Telugu, Kannada), whose
  // ZWJ is escaped and marked.
  const half = { gu: ['\u0A95', '\u0ACD', '\u0AB7'], ml: ['\u0D15', '\u0D4D', '\u0D37'], si: ['\u0D9A', '\u0DCA', '\u0DC2'],
    pa: ['\u0A15', '\u0A4D', '\u0A38'], or: ['\u0B15', '\u0B4D', '\u0B37'], te: ['\u0C15', '\u0C4D', '\u0C37'],
    kn: ['\u0C95', '\u0CCD', '\u0CB7'] };
  for (const [key, joiner, kept] of [['gu', '\u200D', true], ['ml', '\u200D', true], ['si', '\u200D', true],
    ['pa', '\u200C', true], ['or', '\u200C', true], ['te', '\u200C', true], ['kn', '\u200C', true],
    ['pa', '\u200D', false], ['or', '\u200D', false], ['te', '\u200D', false], ['kn', '\u200D', false]]) {
    const [k, v, x] = half[key], org = k + v + joiner + x;
    assert.strictEqual(org.normalize('NFC'), org, 'CONTROL: NFC leaves ' + JSON.stringify(org) + ' alone');
    const want = kept ? org : k + v + '\\u{200D}' + x;
    assert.deepStrictEqual(shownOrg(org), [want, !kept], key + ' ' + JSON.stringify(joiner));
  }
  // A non-joining letter (Joining_Type U: hamza U+0621, high hamza U+0674) on either side of a ZWNJ: it changes
  // nothing, so it is escaped and marked.
  for (const [org, want] of [['\u0628\u200C\u0621', '\u0628\\u{200C}\u0621'], ['\u0621\u200C\u0628', '\u0621\\u{200C}\u0628'],
    ['\u0628\u200C\u0674', '\u0628\\u{200C}\u0674']])
    assert.deepStrictEqual(shownOrg(org), [want, true], JSON.stringify(org));
  // The first letter of the accepted Arabic range (U+0620, D) joins both ways: kept.
  assert.deepStrictEqual(shownOrg('\u0620\u200C\u0628'), ['\u0620\u200C\u0628', false], 'U+0620');
  // A virama joiner at the very end of the word (a chillu-style ending) and a superscript alef skipped like a harakah.
  assert.deepStrictEqual(shownOrg('\u0D28\u0D4D\u200D'), ['\u0D28\u0D4D\\u{200D}', true], 'joiner at the end');
  assert.deepStrictEqual(shownOrg('\u0628\u0670\u200C\u0628')[0], '\u0628\u0670\u200C\u0628', 'superscript alef before the ZWNJ');
  // Sinhala keeps only the ZWJ: a ZWNJ after al-lakuna changes nothing, so it is escaped and marked.
  assert.deepStrictEqual(shownOrg('\u0D9A\u0DCA\u200C\u0DC2'), ['\u0D9A\u0DCA\\u{200C}\u0DC2', true], 'Sinhala ZWNJ');
  // A known false positive, pinned so it is a decision: a harakah AFTER the ZWNJ is not skipped, so the joiner is
  // escaped. Only the text half pins joinerInWord here: the flag is also set by the mark-with-no-letter rule.
  assert.deepStrictEqual(shownOrg('\u0628\u200C\u064E\u0628'), ['\u0628\\u{200C}\u064E\u0628', true]);
  // More spelling that stays: a ZWNJ before an R letter (beh, ZWNJ, alef), and after Arabic-extended D letters (heh goal
  // U+06C1, the Arabic Supplement U+0750).
  for (const org of ['\u0628\u200C\u0627', '\u06C1\u200C\u0628', '\u0750\u200C\u0628'])
    assert.deepStrictEqual(shownOrg(org), [org, false], JSON.stringify(org));
  // More spelling that stays: a Persian ZWNJ after a harakah, and a Bengali ZWNJ after its virama.
  for (const org of ['\u0628\u064E\u200C\u0628', '\u0995\u09CD\u200C\u09B7'])
    assert.deepStrictEqual(shownOrg(org), [org, false], JSON.stringify(org));
});
