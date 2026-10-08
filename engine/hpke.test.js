/**
 * kosmos#5535 (E0.6) slice 1: engine/hpke.js against RFC 9180's own test vectors, section A.2.1
 * (DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20Poly1305, mode_base), copied byte for byte from
 * https://www.rfc-editor.org/rfc/rfc9180.txt. Every intermediate the RFC publishes is checked, so a
 * wrong label, length or concatenation fails at the step that is wrong, not only at the ciphertext.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const hpke = require('./hpke');
const { deriveKeyPair, encap, decap, keySchedule, nonceFor, aeadSeal, aeadOpen } = hpke.hpkeVectorSeamsForTests();

const h = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const V = {
  info: h('4f6465206f6e2061204772656369616e2055726e'),
  ikmE: h('909a9b35d3dc4713a5e72a4da274b55d3d3821a37e5d099e74a647db583a904b'),
  pkEm: h('1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a'),
  skEm: h('f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600'),
  ikmR: h('1ac01f181fdf9f352797655161c58b75c656a6cc2716dcb66372da835542e1df'),
  pkRm: h('4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a'),
  skRm: h('8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb'),
  enc: h('1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a'),
  sharedSecret: h('0bbe78490412b4bbea4812666f7916932b828bba79942424abb65244930d69a7'),
  keyScheduleContext: h(`00431df6cd95e11ff49d7013563baf7f11588c75a6611e
    e2a4404a49306ae4cfc5b69c5718a60cc5876c358d3f7fc31ddb598503f67be58ea1 e798c0bb19eb9796`),
  secret: h('5b9cd775e64b437a2335cf499361b2e0d5e444d5cb41a8a53336d8fe402282c6'),
  key: h('ad2744de8e17f4ebba575b3f5f5a8fa1f69c2a07f6e7500bc60ca6e3e3ec1c91'),
  baseNonce: h('5c4d98150661b848853b547f'),
  exporterSecret: h('a3b010d4994890e2c6968a36f64470d3c824c8f5029942feb11e7a74b2921922'),
};
const PT = h('4265617574792069732074727574682c20747275746820626561757479');
const ENCRYPTIONS = [
  [0, '436f756e742d30', '5c4d98150661b848853b547f', '1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db 21993c62ce81883d2dd1b51a28'],
  [1, '436f756e742d31', '5c4d98150661b848853b547e', '6b53c051e4199c518de79594e1c4ab18b96f081549d45ce015be002090bb119e 85285337cc95ba5f59992dc98c'],
  [2, '436f756e742d32', '5c4d98150661b848853b547d', '71146bd6795ccc9c49ce25dda112a48f202ad220559502cef1f34271e0cb4b02 b4f10ecac6f48c32f878fae86b'],
  [4, '436f756e742d34', '5c4d98150661b848853b547b', '63357a2aa291f5a4e5f27db6baa2af8cf77427c7c1a909e0b37214dd47db122b b153495ff0b02e9e54a50dbe16'],
  [255, '436f756e742d323535', '5c4d98150661b848853b5480', '18ab939d63ddec9f6ac2b60d61d36a7375d2070c9b683861110757062c52b888 0a5f6b3936da9cd6c23ef2a95c'],
  [256, '436f756e742d323536', '5c4d98150661b848853b557f', '7a4a13e9ef23978e2c520fd4d2e757514ae160cd0cd05e556ef692370ca53076 214c0c40d4c728d6ed9e727a5b'],
];

test('#5535 RFC 9180 A.2.1: DeriveKeyPair gives the published sender and recipient keys', () => {
  const e = deriveKeyPair(V.ikmE), r = deriveKeyPair(V.ikmR);
  assert.equal(e.sk.toString('hex'), V.skEm.toString('hex'));
  assert.equal(e.pk.toString('hex'), V.pkEm.toString('hex'));
  assert.equal(r.sk.toString('hex'), V.skRm.toString('hex'));
  assert.equal(r.pk.toString('hex'), V.pkRm.toString('hex'));
});

test('#5535 RFC 9180 A.2.1: Encap with ikmE and Decap agree on the published shared secret and enc', () => {
  const s = encap(V.pkRm, V.ikmE);
  assert.equal(s.enc.toString('hex'), V.enc.toString('hex'));
  assert.equal(s.sharedSecret.toString('hex'), V.sharedSecret.toString('hex'));
  assert.equal(decap(V.enc, V.skRm).toString('hex'), V.sharedSecret.toString('hex'));
});

test('#5535 RFC 9180 A.2.1: the key schedule gives the published context, secret, key, nonce and exporter secret', () => {
  const ks = keySchedule(V.sharedSecret, V.info);
  assert.equal(ks.keyScheduleContext.toString('hex'), V.keyScheduleContext.toString('hex'));
  assert.equal(ks.secret.toString('hex'), V.secret.toString('hex'));
  assert.equal(ks.key.toString('hex'), V.key.toString('hex'));
  assert.equal(ks.baseNonce.toString('hex'), V.baseNonce.toString('hex'));
  assert.equal(ks.exporterSecret.toString('hex'), V.exporterSecret.toString('hex'));
});

test('#5535 RFC 9180 A.2.1.1: every published encryption (sequences 0, 1, 2, 4, 255, 256) seals and opens byte for byte', () => {
  for (const [seq, aad, nonce, ct] of ENCRYPTIONS) {
    const n = nonceFor(V.baseNonce, seq);
    assert.equal(n.toString('hex'), nonce, `nonce for sequence ${seq}`);
    assert.equal(aeadSeal(V.key, n, h(aad), PT).toString('hex'), h(ct).toString('hex'), `ciphertext for sequence ${seq}`);
    assert.equal(aeadOpen(V.key, n, h(aad), h(ct)).toString('hex'), PT.toString('hex'), `plaintext for sequence ${seq}`);
  }
});

test('#5535 RFC 9180 A.2.1.1 through the EXPORTED hpkeOpen: the published sequence-0 message opens', () => {
  // The vector tests above check each step; this checks the production entry point composes them (key, not the
  // exporter secret; sequence 0, not another), which a round trip alone cannot show.
  const [, aad, , ct] = ENCRYPTIONS[0];
  assert.equal(hpke.hpkeOpen(V.skRm, V.enc, V.info, h(aad), h(ct)).toString('hex'), PT.toString('hex'));
  assert.equal(hpke.hpkeOpen(V.skRm, V.enc, V.info, h(ENCRYPTIONS[1][1]), h(ENCRYPTIONS[1][3])), null,
    'CONTROL: the sequence-1 message does not open as a single-shot (sequence 0) message');
});

test('#5535 seal/open: a fresh key pair round-trips, and each seal uses a fresh ephemeral key', () => {
  const r = hpke.hpkeKeyPair();
  const info = Buffer.from('kosmos-backup v1 org/member/epoch1'), aad = Buffer.from('chunk-name-abc');
  const a = hpke.hpkeSeal(r.pk, info, aad, Buffer.from('agent file bytes'));
  const b = hpke.hpkeSeal(r.pk, info, aad, Buffer.from('agent file bytes'));
  assert.notEqual(a.enc.toString('hex'), b.enc.toString('hex'), 'two seals reused an ephemeral key');
  assert.notEqual(a.ct.toString('hex'), b.ct.toString('hex'));
  assert.equal(hpke.hpkeOpen(r.sk, a.enc, info, aad, a.ct).toString(), 'agent file bytes');
  assert.equal(hpke.hpkeOpen(r.sk, b.enc, info, aad, b.ct).toString(), 'agent file bytes');
});

test('#5535 open returns null, never throws, on every kind of wrong input (one shared control: the untampered message opens)', () => {
  const r = hpke.hpkeKeyPair(), other = hpke.hpkeKeyPair();
  const info = Buffer.from('i'), aad = Buffer.from('chunk-A');
  const { enc, ct } = hpke.hpkeSeal(r.pk, info, aad, Buffer.from('secret'));
  assert.equal(hpke.hpkeOpen(r.sk, enc, info, aad, ct).toString(), 'secret', 'CONTROL: the untampered message opens');
  const flip = (b, i) => { const c = Buffer.from(b); c[i] ^= 1; return c; };
  const cases = {
    'another member\'s key (a restore of B cannot read A)': () => hpke.hpkeOpen(other.sk, enc, info, aad, ct),
    'a different chunk name as aad (a chunk under the wrong name)': () => hpke.hpkeOpen(r.sk, enc, info, Buffer.from('chunk-B'), ct),
    'a different info': () => hpke.hpkeOpen(r.sk, enc, Buffer.from('j'), aad, ct),
    'one ciphertext bit flipped': () => hpke.hpkeOpen(r.sk, enc, info, aad, flip(ct, 0)),
    'one tag bit flipped': () => hpke.hpkeOpen(r.sk, enc, info, aad, flip(ct, ct.length - 1)),
    'one enc bit flipped': () => hpke.hpkeOpen(r.sk, flip(enc, 5), info, aad, ct),
    'a truncated ciphertext (still over the tag length, so it reaches the AEAD)': () => hpke.hpkeOpen(r.sk, enc, info, aad, ct.subarray(0, ct.length - 1)),
    'a ciphertext shorter than the tag (stopped by the length check)': () => hpke.hpkeOpen(r.sk, enc, info, aad, ct.subarray(0, 10)),
    'a short enc': () => hpke.hpkeOpen(r.sk, enc.subarray(0, 31), info, aad, ct),
    'a non-Buffer key': () => hpke.hpkeOpen('not a key', enc, info, aad, ct),
    'an all-zero enc (a low-order point)': () => hpke.hpkeOpen(r.sk, Buffer.alloc(32), info, aad, ct),
  };
  for (const [name, fn] of Object.entries(cases)) {
    let got; assert.doesNotThrow(() => { got = fn(); }, name);
    assert.equal(got, null, name);
  }
});

test('#5535 the vector seams are refused outside a test process', () => {
  const le = require('./live-execution');
  const real = le.inTestProcess;
  try {
    le.inTestProcess = () => false;
    assert.throws(() => hpke.hpkeVectorSeamsForTests(), /outside a test/);
  } finally { le.inTestProcess = real; }
  assert.equal(typeof hpke.hpkeVectorSeamsForTests().encap, 'function', 'CONTROL: inside a test they are handed out');
});

test('#5535 seal refuses a malformed public key loudly (a caller bug, not input from storage)', () => {
  assert.throws(() => hpke.hpkeSeal(Buffer.alloc(31), Buffer.alloc(0), Buffer.alloc(0), Buffer.from('x')), /32 bytes/);
  // A low-order point is refused either by OpenSSL's own all-zero check during derivation (what Node 26 does)
  // or by hpke.js's RFC 9180 7.1.4 check behind it; either way seal must not produce a message.
  assert.throws(() => hpke.hpkeSeal(Buffer.alloc(32), Buffer.alloc(0), Buffer.alloc(0), Buffer.from('x')), /all-zero|failed during derivation/, 'an all-zero public key is a low-order point and is refused');
});
