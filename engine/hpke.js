/**
 * kosmos#5535 (E0.6, Enterprise backup) slice 1: HPKE base mode, RFC 9180, one suite only:
 * DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20-Poly1305 (kem 0x0020, kdf 0x0001, aead 0x0003).
 *
 * Why HPKE and not fedseal's pairing: a backup object is encrypted TO a member's public key by a Mac
 * that must not be able to decrypt it afterwards. That needs a fresh ephemeral key per object (the
 * sender keeps nothing); fedseal's static-static pairing between two long-term board keys does not
 * give that. The design and its two review rounds are on #5535 (v2, v2.1).
 *
 * Only single-shot use is exported: one seal and one open, each setting up a context and use sequence 0, the
 * shape one backup object needs (a fresh encapsulation per object). The deterministic setup and the
 * per-sequence nonce and AEAD steps exist only for the RFC 9180 test vectors in hpke.test.js.
 *
 * Every open returns null on ANY failure (wrong key, tampered byte, wrong info or aad, malformed
 * input) and never throws, the same contract as fedseal: input from storage must not take the board down.
 * Node's crypto supplies X25519, HMAC-SHA256 and ChaCha20-Poly1305; nothing here is a new primitive,
 * only RFC 9180's composition of them, pinned byte for byte by the RFC's own vectors.
 */
const crypto = require('crypto');

const KEM_ID = 0x0020, KDF_ID = 0x0001, AEAD_ID = 0x0003;
const N_SECRET = 32, N_ENC = 32, N_PK = 32, N_K = 32, N_N = 12, N_H = 32, N_T = 16;
const MODE_BASE = 0x00;
const ZERO32 = Buffer.alloc(32);
// 2^255 - 19, little-endian: an X25519 u-coordinate at or above it, or with bit 255 set, is not canonical.
const P25519_LE = Buffer.from('edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f', 'hex');

function i2osp(n, w) {
  if (!Number.isSafeInteger(n) || n < 0 || n >= 2 ** (8 * w)) throw new Error('hpke: I2OSP value out of range');
  const b = Buffer.alloc(w);
  for (let i = w - 1; i >= 0 && n > 0; i--) { b[i] = n & 0xff; n = Math.floor(n / 256); }
  return b;
}
const KEM_SUITE = Buffer.concat([Buffer.from('KEM'), i2osp(KEM_ID, 2)]);
const HPKE_SUITE = Buffer.concat([Buffer.from('HPKE'), i2osp(KEM_ID, 2), i2osp(KDF_ID, 2), i2osp(AEAD_ID, 2)]);
const V1 = Buffer.from('HPKE-v1');

function extract(salt, ikm) {
  return crypto.createHmac('sha256', salt.length ? salt : Buffer.alloc(N_H)).update(ikm).digest();
}
function expand(prk, info, len) {
  if (len > 255 * N_H) throw new Error('hpke: HKDF-Expand length over 255 * Nh');  // RFC 5869: the counter is one byte
  const out = []; let t = Buffer.alloc(0);
  for (let i = 1, have = 0; have < len; i++) {
    t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, info, Buffer.from([i])])).digest();
    out.push(t); have += t.length;
  }
  return Buffer.concat(out).subarray(0, len);
}
function labeledExtract(suite, salt, label, ikm) {
  return extract(salt, Buffer.concat([V1, suite, Buffer.from(label), ikm]));
}
function labeledExpand(suite, prk, label, info, len) {
  return expand(prk, Buffer.concat([i2osp(len, 2), V1, suite, Buffer.from(label), info]), len);
}

// PKCS#8 wrapper for a raw X25519 private key (OID 1.3.101.110): Node imports X25519 keys only as DER or JWK.
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
function privFromRaw(sk) {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, sk]), format: 'der', type: 'pkcs8' });
  return { privateKey, pk: Buffer.from(crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url') };
}
function pubFromRaw(pk) {
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(pk).toString('base64url') }, format: 'jwk' });
}
function dh(privateKey, pk) {
  const z = crypto.diffieHellman({ privateKey, publicKey: pubFromRaw(pk) });
  // RFC 9180 7.1.4: abort on an all-zero output (a low-order point). z is SECRET, so compare in constant time.
  // On Node 26 OpenSSL refuses every canonical low-order point before this line runs; this is the backstop.
  if (crypto.timingSafeEqual(z, ZERO32)) throw new Error('all-zero X25519 output');
  return z;
}

/** DeriveKeyPair (RFC 9180 7.1.3) for X25519: the raw 32-byte secret, and its public key. */
function deriveKeyPair(ikm) {
  const prk = labeledExtract(KEM_SUITE, Buffer.alloc(0), 'dkp_prk', ikm);
  const sk = labeledExpand(KEM_SUITE, prk, 'sk', Buffer.alloc(0), N_SECRET);
  return { sk, pk: privFromRaw(sk).pk };
}

/** A fresh member key pair, raw 32-byte halves (the private half is what escrow and device wraps hold). */
function hpkeKeyPair() { return deriveKeyPair(crypto.randomBytes(32)); }

function extractAndExpand(z, kemContext) {
  const prk = labeledExtract(KEM_SUITE, Buffer.alloc(0), 'eae_prk', z);
  return labeledExpand(KEM_SUITE, prk, 'shared_secret', kemContext, N_SECRET);
}
function encap(pkR, ikmE) {
  const e = ikmE ? deriveKeyPair(ikmE) : hpkeKeyPair();
  const z = dh(privFromRaw(e.sk).privateKey, pkR);
  const enc = e.pk;
  return { sharedSecret: extractAndExpand(z, Buffer.concat([enc, pkR])), enc };
}
function decap(enc, skR) {
  const r = privFromRaw(skR);
  const z = dh(r.privateKey, enc);
  return extractAndExpand(z, Buffer.concat([enc, r.pk]));
}
function keySchedule(sharedSecret, info) {
  const pskIdHash = labeledExtract(HPKE_SUITE, Buffer.alloc(0), 'psk_id_hash', Buffer.alloc(0));
  const infoHash = labeledExtract(HPKE_SUITE, Buffer.alloc(0), 'info_hash', info);
  const ctx = Buffer.concat([Buffer.from([MODE_BASE]), pskIdHash, infoHash]);
  const secret = labeledExtract(HPKE_SUITE, sharedSecret, 'secret', Buffer.alloc(0));
  return { keyScheduleContext: ctx, secret,
    key: labeledExpand(HPKE_SUITE, secret, 'key', ctx, N_K),
    baseNonce: labeledExpand(HPKE_SUITE, secret, 'base_nonce', ctx, N_N),
    exporterSecret: labeledExpand(HPKE_SUITE, secret, 'exp', ctx, N_H) };
}
function nonceFor(baseNonce, seq) {
  const n = Buffer.from(baseNonce); const s = i2osp(seq, N_N);
  for (let i = 0; i < N_N; i++) n[i] ^= s[i];
  return n;
}
function aeadSeal(key, nonce, aad, pt) {
  const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: N_T });
  c.setAAD(aad, { plaintextLength: pt.length });
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}
function aeadOpen(key, nonce, aad, ct) {
  const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: N_T });
  d.setAAD(aad, { plaintextLength: ct.length - N_T });
  d.setAuthTag(ct.subarray(ct.length - N_T));
  return Buffer.concat([d.update(ct.subarray(0, ct.length - N_T)), d.final()]);
}

/* RFC 9180 vector seams, for hpke.test.js ONLY: a fixed ikmE gives the same key and nonce every time, and
   aeadSeal takes any nonce, so handing these to production code would invite nonce reuse. Refused outside a
   test process, as connect.js's setWindowsSigninHostForTests is. */
function hpkeVectorSeamsForTests() {
  if (!require('./live-execution').inTestProcess()) throw new Error('refusing to hand out the HPKE vector seams outside a test');
  return { deriveKeyPair, encap, decap, keySchedule, nonceFor, aeadSeal, aeadOpen };
}

/* A public key must be in canonical form. X25519 itself ignores bit 255 and reduces mod p, but RFC 9180
   puts the RAW pkR bytes into kem_context while the recipient rebuilds them from its own key in canonical
   form, so a non-canonical pkR seals fine and can NEVER be opened: a backup that writes and cannot be
   restored. Refused at seal time instead (review round 2 measured the silent failure). This is a DELIBERATE
   local departure from RFC 7748 section 5, which says X25519 implementations MUST accept non-canonical u: a
   backup key that cannot round-trip is worse than a loud error at the caller. Open is unchanged. */
function canonicalPublicKey(pk) {
  if (pk[31] & 0x80) return false;
  for (let i = 31; i >= 0; i--) {  // little-endian compare with p: true only when pk < p
    if (pk[i] < P25519_LE[i]) return true;
    if (pk[i] > P25519_LE[i]) return false;
  }
  return false;  // equal to p
}

const asBuf = (x) => (Buffer.isBuffer(x) ? x : (x instanceof Uint8Array ? Buffer.from(x) : null));

/** Seal one message to pkR. Returns { enc, ct } (enc: 32 bytes, ct: plaintext + 16), or throws on a bad public key. */
function hpkeSeal(pkR, info, aad, pt) {
  const pk = asBuf(pkR), i = asBuf(info), a = asBuf(aad), p = asBuf(pt);
  if (!pk || pk.length !== N_PK || !i || !a || !p) throw new Error('hpke: pkR must be 32 bytes and info, aad, pt Buffers');
  if (!canonicalPublicKey(pk)) throw new Error('hpke: pkR is not a canonical X25519 public key (bit 255 set, or not below 2^255 - 19)');
  const { sharedSecret, enc } = encap(pk);
  const ks = keySchedule(sharedSecret, i);
  return { enc, ct: aeadSeal(ks.key, nonceFor(ks.baseNonce, 0), a, p) };
}

/** Open one sealed message with skR. Returns the plaintext Buffer, or null on ANY failure. Never throws. */
function hpkeOpen(skR, enc, info, aad, ct) {
  try {
    const sk = asBuf(skR), e = asBuf(enc), i = asBuf(info), a = asBuf(aad), c = asBuf(ct);
    if (!sk || sk.length !== N_SECRET || !e || e.length !== N_ENC || !i || !a || !c || c.length < N_T) return null;
    const ks = keySchedule(decap(e, sk), i);
    return aeadOpen(ks.key, nonceFor(ks.baseNonce, 0), a, c);
  } catch { return null; }
}

module.exports = {
  hpkeSeal,
  hpkeOpen,
  hpkeKeyPair,
  hpkeVectorSeamsForTests,
};
