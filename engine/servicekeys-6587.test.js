'use strict';
/*
 * kosmos#6587 (S-7a slice 1): engine/servicekeys.js checks a service key set exactly as kosmos-relay does (relay #474,
 * crates/proto/src/keyset.rs). The fixtures are the relay's published test vectors (docs/token-format.md, "Service
 * key set test vectors"): the same seeds, the same document bytes and the same signature, so the two languages are
 * held to one answer. Every refusal the spec lists has an arm here.
 *   node --test engine/servicekeys-6587.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sk = require('./servicekeys');

const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const keyFromSeed = (byte) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.alloc(32, byte)]), format: 'der', type: 'pkcs8' });
const spkiOf = (priv) => crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64');
const rawOf = (priv) => crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12);
const sign = (priv, bytes) => crypto.sign(null, Buffer.from(bytes), priv).toString('base64');

const ROOT = keyFromSeed(0x09);
const K7 = keyFromSeed(0x07);
const K8 = keyFromSeed(0x08);
const ROOT_PUB = 'MCowBQYDK2VwAyEA/RckOFqgx1tk+3jNYC+h2ZH96/drE8WO1wLqyDXp9hg=';
const K7_PUB = 'MCowBQYDK2VwAyEA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=';
const K8_PUB = 'MCowBQYDK2VwAyEAE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8o=';
const VECTOR = '{\n  "type": "kosmos-service-keys",\n  "service_keys": [\n    {\n      "kid": "_oEsEvOrTOY",\n      "pub": "MCowBQYDK2VwAyEA6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=",\n      "role": "current"\n    },\n    {\n      "kid": "XCm3jxCjWkk",\n      "pub": "MCowBQYDK2VwAyEAE5j2LG0aRXxRumpLXz29L2n8qTIWIY3ImX5Ba9F9k8o=",\n      "role": "next"\n    }\n  ],\n  "seq": 1,\n  "issued": "2025-08-24"\n}\n';
const VECTOR_SIG = 'Z4eSzkTKtuFexVyEhVtfSo2kWevcWC8xvaCNfxJVxInx40cOLCm6LtjLiX7fJ7oKWcDK+ydIXv+FybM4H2M3Bg==';
const VECTOR_SHA = '0064ab6f7651aabd7418060caa131ff34f2811b25d3485b08da6881ff9aa7aac';

const check = (bytes, sig, held = null) => sk.verifyServiceKeySet({ bytes: Buffer.from(bytes), sig, recoveryKeys: [ROOT_PUB], held });
// A document as the signing tool writes it (two-space indent, final newline), signed by the root.
const doc = (fields) => JSON.stringify(Object.assign({
  type: 'kosmos-service-keys',
  service_keys: [{ kid: '_oEsEvOrTOY', pub: K7_PUB, role: 'current' }],
  seq: 1,
  issued: '2025-08-24',
}, fields), null, 2) + '\n';
const signed = (text, by = ROOT) => [text, sign(by, text)];
// A refusal for the named reason, so an arm cannot pass because an earlier check refused everything.
const refused = (r, why, label) => { assert.equal(r.ok, false, label); assert.match(r.why, why, label + ': ' + r.why); };

test('the fixtures are the relay vectors: seeds give the published keys and kids', () => {
  assert.equal(spkiOf(ROOT), ROOT_PUB);
  assert.equal(spkiOf(K7), K7_PUB);
  assert.equal(spkiOf(K8), K8_PUB);
  assert.equal(sk.kidOf(rawOf(K7)), '_oEsEvOrTOY');
  assert.equal(sk.kidOf(rawOf(K8)), 'XCm3jxCjWkk');
  assert.equal(crypto.createHash('sha256').update(VECTOR).digest('hex'), VECTOR_SHA);
  // Ed25519 signing is deterministic, so the root signing the vector bytes gives the published signature.
  assert.equal(sign(ROOT, VECTOR), VECTOR_SIG);
});

test('the published set is taken, with both keys and its seq and sha256', () => {
  const r = check(VECTOR, VECTOR_SIG);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.seq, 1);
  assert.equal(r.sha256, VECTOR_SHA);
  assert.deepEqual(r.keys, [
    { kid: '_oEsEvOrTOY', pub: K7_PUB, role: 'current' },
    { kid: 'XCm3jxCjWkk', pub: K8_PUB, role: 'next' },
  ]);
  // A trailing newline on the .sig file is trimmed, as the relay does.
  assert.equal(check(VECTOR, VECTOR_SIG + '\n').ok, true);
});

test('off as shipped: the recovery keys are manifest-verify\'s, empty today, and off is its own answer', () => {
  const mv = require('./manifest-verify');
  assert.deepEqual(mv.RECOVERY_KEYS, [], 'a recovery key was pinned: this arm and the excuse in engine.reachable need revisiting');
  const r = sk.verifyServiceKeySet({ bytes: Buffer.from(VECTOR), sig: VECTOR_SIG });
  assert.equal(r.ok, false);
  assert.equal(r.off, true, 'off is told apart from a refusal');
  assert.match(r.why, /no Kosmos recovery key is set/);
  // CONTROL: with a recovery key given, the same set is checked (and taken), and a refusal is not "off".
  assert.equal(sk.verifyServiceKeySet({ bytes: Buffer.from(VECTOR), sig: VECTOR_SIG, recoveryKeys: [ROOT_PUB] }).ok, true);
  assert.equal(sk.verifyServiceKeySet({ bytes: Buffer.from(VECTOR), sig: sign(K7, VECTOR), recoveryKeys: [ROOT_PUB] }).off, undefined);
});

test('refused: signed by a service key, one changed byte, no signature, a non-canonical signature', () => {
  refused(check(VECTOR, sign(K7, VECTOR)), /not signed/, 'signed by a service key');
  const changed = Buffer.from(VECTOR); changed[changed.length - 3] ^= 1;
  refused(check(changed, VECTOR_SIG), /not signed/, 'one changed byte');
  refused(check(VECTOR, ''), /not signed/, 'no signature');
  // The same 64 bytes spelled with a non-zero trailing bit: lenient base64 would read it, the relay's does not.
  const last = VECTOR_SIG.at(-3);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bumped = VECTOR_SIG.slice(0, -3) + alphabet[alphabet.indexOf(last) + 1] + '==';
  assert.deepEqual(Buffer.from(bumped, 'base64'), Buffer.from(VECTOR_SIG, 'base64'), 'CONTROL: the bumped spelling decodes to the same bytes');
  refused(check(VECTOR, bumped), /not signed/, 'non-canonical signature');
});

test('refused: the release key list type (domain separation), and a document that is not an object', () => {
  const r = check(...signed(doc({ type: 'kosmos-release-keys' })));
  assert.equal(r.ok, false);
  assert.match(r.why, /not a service key set/);
  refused(check(...signed('[1]\n')), /not a service key set/, 'not an object');
  // CONTROL: the same document with its own type is taken, so the arm above refused on the type alone.
  assert.equal(check(...signed(doc({}))).ok, true);
});

test('refused: a member named twice, at the top or inside an entry', () => {
  const twiceType = '{"type": "kosmos-service-keys", "type": "kosmos-service-keys", "service_keys": [{"kid": "_oEsEvOrTOY", "pub": "' + K7_PUB + '", "role": "current"}], "seq": 1, "issued": "2025-08-24"}\n';
  const r = check(...signed(twiceType));
  assert.equal(r.ok, false);
  assert.match(r.why, /names the member "type" twice/);
  const twicePub = '{"type": "kosmos-service-keys", "service_keys": [{"kid": "_oEsEvOrTOY", "pub": "' + K8_PUB + '", "pub": "' + K7_PUB + '", "role": "current"}], "seq": 1, "issued": "2025-08-24"}\n';
  refused(check(...signed(twicePub)), /names the member "pub" twice/, 'pub twice');
  // Names are compared after unescaping: "type" is "type".
  const escaped = '{"type": "kosmos-service-keys", "typ\\u0065": "kosmos-service-keys", "service_keys": [{"kid": "_oEsEvOrTOY", "pub": "' + K7_PUB + '", "role": "current"}], "seq": 1, "issued": "2025-08-24"}\n';
  refused(check(...signed(escaped)), /names the member "type" twice/, 'type escaped twice');
});

test('refused: JSON the relay refuses (bad UTF-8, a lone surrogate, a number out of range, nested too deeply)', () => {
  const base = doc({});
  const withExtra = (raw) => Buffer.concat([Buffer.from(base.slice(0, base.lastIndexOf('}'))), Buffer.from(',\n  "x": '), Buffer.from(raw), Buffer.from('\n}\n')]);
  const signedBuf = (b) => [b, crypto.sign(null, b, ROOT).toString('base64')];
  refused(check(...signedBuf(withExtra(Buffer.from([0x22, 0xff, 0x22])))), /not readable/, 'a byte that is not UTF-8');
  refused(check(...signedBuf(withExtra(Buffer.from('"\\ud800"')))), /lone surrogate/, 'a lone high surrogate');
  refused(check(...signedBuf(withExtra(Buffer.from('"\\udc00x"')))), /lone surrogate/, 'a lone low surrogate');
  refused(check(...signedBuf(withExtra(Buffer.from('{"\\ud800": 1}')))), /lone surrogate/, 'a lone surrogate in a member name');
  refused(check(...signedBuf(withExtra(Buffer.from('[{"a": 1, "a": 2}]')))), /names the member "a" twice/, 'a member twice inside an array element');
  refused(check(...signedBuf(withExtra(Buffer.from('1e400')))), /out of range/, 'a number out of range');
  refused(check(...signedBuf(withExtra(Buffer.from('['.repeat(127) + ']'.repeat(127))))), /nested too deeply/, '128 nested, the outer object counted');
  // CONTROLS: a real surrogate pair, a large finite number, and 127 nested (the deepest the relay takes) are fine.
  assert.equal(check(...signedBuf(withExtra(Buffer.from('"\\ud83d\\ude00"')))).ok, true, 'a surrogate pair');
  assert.equal(check(...signedBuf(withExtra(Buffer.from('1e300')))).ok, true, 'a finite large number');
  assert.equal(check(...signedBuf(withExtra(Buffer.from('['.repeat(126) + ']'.repeat(126))))).ok, true, '127 nested');
  // A leading BOM on the document is refused, as by the relay.
  refused(check(...signedBuf(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(base)]))), /not readable/, 'a BOM');
});

test('the .sig is trimmed as Rust trims (U+0085 is whitespace, U+FEFF is not)', () => {
  assert.equal(check(VECTOR, '\u0085' + VECTOR_SIG + '\n').ok, true, 'U+0085 trimmed');
  refused(check(VECTOR, '\ufeff' + VECTOR_SIG), /not signed/, 'a BOM is not trimmed');
});

test('refused: a seq out of range or not a plain integer (1.0 and 1e0 read as 1 to JSON.parse, not to the relay)', () => {
  for (const s of ['0', '-1', '2147483648', '1.0', '1e0', '"1"']) {
    const text = doc({}).replace('"seq": 1', '"seq": ' + s);
    assert.notEqual(text, doc({}), 'the seq was replaced');
    refused(check(...signed(text)), /sequence number/, 'seq ' + s);
  }
  assert.equal(check(...signed(doc({ seq: 2147483647 }))).ok, true, 'CONTROL: the largest seq is taken');
});

test('refused: an issue date that is not a real YYYY-MM-DD', () => {
  for (const d of ['2025-02-29', '2025-13-01', '0000-01-01', '2025-1-01', '2025-08-24T00:00', 20250824]) {
    refused(check(...signed(doc({ issued: d }))), /issue date/, 'issued ' + d);
  }
  assert.equal(check(...signed(doc({ issued: '2024-02-29' }))).ok, true, 'CONTROL: a leap day');
});

test('refused: the keys break a rule (none, four, a wrong kid, zero or two current, the root, twice, weak, non-canonical)', () => {
  const k7 = { kid: '_oEsEvOrTOY', pub: K7_PUB, role: 'current' };
  const k8 = { kid: 'XCm3jxCjWkk', pub: K8_PUB, role: 'next' };
  const rootEntry = { kid: sk.kidOf(rawOf(ROOT)), pub: ROOT_PUB, role: 'next' };
  const K9 = keyFromSeed(0x0a);
  const k9 = { kid: sk.kidOf(rawOf(K9)), pub: spkiOf(K9), role: 'retiring' };
  const cases = {
    'no keys': [[], /names no key/],
    'four keys': [[k7, k8, k9, { kid: sk.kidOf(rawOf(keyFromSeed(0x0b))), pub: spkiOf(keyFromSeed(0x0b)), role: 'next' }], /more than 3 keys/],
    'a wrong kid': [[{ ...k7, kid: 'XCm3jxCjWkk' }], /under another kid/],
    'no current key': [[{ ...k7, role: 'next' }], /exactly one current/],
    'two current keys': [[k7, { ...k8, role: 'current' }], /exactly one current/],
    'the root listed': [[k7, rootEntry], /recovery key as a service key/],
    'a key twice': [[k7, { ...k7, role: 'next' }], /lists a key twice/],
    'an unknown role': [[{ ...k7, role: 'primary' }], /entry that is not one/],
    'a raw 32-byte key': [[{ ...k7, pub: rawOf(K7).toString('base64') }], /key that is not one/],
    'missing padding': [[{ ...k7, pub: K7_PUB.slice(0, -1) }], /key that is not one/],
  };
  for (const [name, [keys, why]] of Object.entries(cases)) refused(check(...signed(doc({ service_keys: keys }))), why, name);
  // A weak (small-order) key, in its canonical SPKI spelling: the identity point.
  const weak = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from('01' + '00'.repeat(31), 'hex')]).toString('base64');
  const weakKid = sk.kidOf(Buffer.from('01' + '00'.repeat(31), 'hex'));
  refused(check(...signed(doc({ service_keys: [k7, { kid: weakKid, pub: weak, role: 'next' }] }))), /key that is not one/, 'a weak key');
  // With two recovery keys, only the one that SIGNED is refused as a listed key, as the relay does.
  const other = keyFromSeed(0x0c);
  const lists = [k7, { kid: sk.kidOf(rawOf(other)), pub: spkiOf(other), role: 'next' }];
  const both = sk.verifyServiceKeySet({ bytes: Buffer.from(doc({ service_keys: lists })), sig: sign(ROOT, doc({ service_keys: lists })), recoveryKeys: [ROOT_PUB, spkiOf(other)] });
  assert.equal(both.ok, true, 'another recovery key listed is not the signing root: ' + both.why);
  // Every small-order point, with the sign bit clear and set, and the two non-canonical spellings of y = 0 and 1.
  const WEAK_HEX = ['00'.repeat(32), '01' + '00'.repeat(31), '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a', 'ec' + 'ff'.repeat(30) + '7f', 'ed' + 'ff'.repeat(30) + '7f', 'ee' + 'ff'.repeat(30) + '7f'];
  for (const h of WEAK_HEX) {
    for (const signBit of [0, 0x80]) {
      const raw = Buffer.from(h, 'hex'); raw[31] = (raw[31] & 0x7f) | signBit;
      const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]).toString('base64');
      assert.equal(sk.rawKey(spki), null, 'weak ' + raw.toString('hex'));
    }
  }
  // Not a point on the curve (y = 2): the relay's key decoding refuses it, and so must this.
  const y2 = Buffer.from('02' + '00'.repeat(31), 'hex');
  const offCurve = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), y2]).toString('base64');
  refused(check(...signed(doc({ service_keys: [k7, { kid: sk.kidOf(y2), pub: offCurve, role: 'next' }] }))), /key that is not one/, 'a key off the curve');
  // CONTROL for the curve check: every real key used here (seeds 07 to 0b) is on the curve.
  for (const b of [7, 8, 9, 10, 11]) assert.ok(sk.rawKey(spkiOf(keyFromSeed(b))), 'seed ' + b + ' is a key');
  assert.equal(check(...signed(doc({ service_keys: [k7, k8] }))).ok, true, 'CONTROL: the two good keys are taken');
});

test('seq only goes up: a lower seq is refused, the same seq only with the same bytes', () => {
  const held = { seq: 1, sha256: VECTOR_SHA };
  assert.equal(check(VECTOR, VECTOR_SIG, held).ok, true, 'the same set again');
  refused(check(...signed(doc({})), held), /reuses sequence number 1/, 'seq 1 with other bytes');
  refused(check(VECTOR, VECTOR_SIG, { seq: 2, sha256: VECTOR_SHA.replace(/^00/, '11') }), /is older \(1\)/, 'a lower seq');
  assert.equal(check(...signed(doc({ seq: 2 })), held).ok, true, 'CONTROL: a higher seq');
  // A held record that cannot be read fails closed rather than switching the rollback check off.
  for (const bad of [{ seq: '5', sha256: VECTOR_SHA }, { seq: 5n, sha256: VECTOR_SHA }, { seq: 0, sha256: VECTOR_SHA }, { seq: 1, sha256: 'x' }, {}, 'held']) {
    refused(check(...signed(doc({ seq: 3 })), bad), /holds is not readable/, 'held ' + String(bad.seq));
  }
});

test('the pinned key (base64url of the raw bytes) is matched against the listed SPKI keys', () => {
  const keys = check(VECTOR, VECTOR_SIG).keys;
  const pin7 = rawOf(K7).toString('base64url');
  assert.equal(sk.pinnedSpki(pin7), K7_PUB);
  assert.equal(sk.pinnedIsListed(pin7 + '\n', keys), true, 'the listed current key, with the trailing newline the file may hold');
  assert.equal(sk.pinnedIsListed(rawOf(K8).toString('base64url'), keys), true, 'the listed next key');
  assert.equal(sk.pinnedIsListed(rawOf(ROOT).toString('base64url'), keys), false, 'a key not on the list');
  // Trimmed as the tunnel trims it (Rust str::trim): a BOM is not whitespace there, so it is no key here either.
  assert.equal(sk.pinnedIsListed('\ufeff' + pin7, keys), false, 'a BOM before the pin');
  assert.equal(sk.pinnedIsListed('\u0085' + pin7 + '\n', keys), true, 'U+0085 is whitespace to Rust');
  for (const bad of ['', null, 'not a key', rawOf(K7).toString('base64'), pin7 + '=']) {
    assert.equal(sk.pinnedIsListed(bad, keys), false, 'unreadable pin ' + JSON.stringify(bad));
  }
});
