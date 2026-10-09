'use strict';
/**
 * kosmos#5535 (E0.6) design v2.1, Keys: the pure half of the backup keys. No I/O, no storage, no coordinator.
 *
 * - A MEMBER backup key pair per member per key epoch (raw X25519 halves). backupformat.js seals every chunk and
 *   manifest to its public half; restore opens with the private half.
 * - The member PRIVATE key is kept only wrapped: HPKE base mode (engine/hpke.js) to one X25519 public key, with the
 *   member-key context (org, member, epoch) as associated data. One form serves every recipient v2.1 names: the org
 *   public key (escrow), the member's enrolled device sealing key (self-restore), and a restore destination (the
 *   unwrap service re-seals to it; restorerequest.js fingerprints that same raw 32-byte key).
 * - A NAMING key per period (HMAC key for chunk names) is 32 random bytes, kept wrapped to the member PUBLIC key
 *   with (org, member, epoch, period) as associated data, so it is recoverable after the Mac is lost.
 *
 * Wraps:  member key  KBK1 | enc(32) | ct(32 + 16)   info "kosmos-backup v1 member-key"
 *         naming key  KBN1 | enc(32) | ct(32 + 16)   info "kosmos-backup v1 naming-key"
 * Distinct magic, info AND a context string that names its kind: a member-key wrap can never open as a naming key.
 *
 * wrap* throw on a caller mistake (a key that is not 32 bytes, a bad context, a non-canonical recipient key, which
 * hpke.js refuses because it could never be opened). unwrap* return null on ANY failure and never throw, as hpke.js
 * and backupformat.js do. unwrapMemberKey REQUIRES the public key the result must derive to: a wrap of the wrong key
 * (a wrapper bug, another epoch's key under this context) is refused rather than restored.
 *
 * Not here: where keys and wraps are stored, the org key pair and escrow, delivering the member public key in the
 * coordinator-signed policy bundle (decision 7), rotation policy, and the walker.
 */
const crypto = require('crypto');
const { hpkeSeal, hpkeOpen, hpkeKeyPair } = require('./hpke');

const FORMAT = 1;
const KEY_LEN = 32, ENC_LEN = 32, TAG_LEN = 16;
const MEMBER_MAGIC = Buffer.from('KBK1');   // Kosmos Backup Key: a wrapped member private key, format 1
const NAMING_MAGIC = Buffer.from('KBN1');   // Kosmos Backup Naming key, wrapped, format 1
const MEMBER_INFO = Buffer.from(`kosmos-backup v${FORMAT} member-key`);
const NAMING_INFO = Buffer.from(`kosmos-backup v${FORMAT} naming-key`);
const WRAP_LEN = 4 + ENC_LEN + KEY_LEN + TAG_LEN;
const MEMBER_FIELDS = ['org', 'member', 'epoch'];
const NAMING_FIELDS = ['org', 'member', 'epoch', 'period'];
// backupformat.js's id alphabet: a lone surrogate would become U+FFFD in the bytes (two contexts, one byte string),
// and a newline could forge a field.
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

const asBuf = (x) => (Buffer.isBuffer(x) ? x : (x instanceof Uint8Array ? Buffer.from(x) : null));

/* The associated data for one kind of wrap: a fixed line naming the kind, then each field. Throws on a bad ctx. */
function contextBytes(kind, fields, ctx) {
  for (const k of fields) {
    if (!ctx || typeof ctx[k] !== 'string' || !ID_RE.test(ctx[k])) throw new Error(`backupkeys: the ${kind} context needs a non-empty ${k} of letters, digits and . _ : -`);
  }
  return Buffer.from(`kosmos-backup v${FORMAT} ${kind}\n` + fields.map((k) => `${k}=${ctx[k]}`).join('\n'));
}
const memberContext = (ctx) => contextBytes('member-key', MEMBER_FIELDS, ctx);
const namingContext = (ctx) => contextBytes('naming-key', NAMING_FIELDS, ctx);

// The public half of a raw X25519 private key (as hpke.js derives it; Node imports X25519 keys only as DER or JWK).
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
function publicKeyOf(sk) {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, sk]), format: 'der', type: 'pkcs8' });
  return Buffer.from(crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url');
}

function key32(x, what) {
  const b = asBuf(x);
  if (!b || b.length !== KEY_LEN) throw new Error(`backupkeys: ${what} must be 32 bytes`);
  return b;
}

/** A fresh member backup key pair { sk, pk } (raw 32-byte X25519 halves). */
function newMemberKey() { return hpkeKeyPair(); }

/** A fresh naming key for one period: 32 random bytes. */
function newNamingKey() { return crypto.randomBytes(KEY_LEN); }

function wrap(magic, info, aad, secret, recipientPk) {
  const { enc, ct } = hpkeSeal(recipientPk, info, aad, secret);   // throws on a bad or non-canonical recipient key
  return Buffer.concat([magic, enc, ct]);
}
function unwrap(magic, info, aad, recipientSk, wrapped) {
  const w = asBuf(wrapped);
  if (!w || w.length !== WRAP_LEN || !w.subarray(0, 4).equals(magic)) return null;
  const out = hpkeOpen(recipientSk, w.subarray(4, 4 + ENC_LEN), info, aad, w.subarray(4 + ENC_LEN));
  return out && out.length === KEY_LEN ? out : null;
}

/** Wrap a member backup private key to one X25519 public key (org, device or destination). Throws on a caller mistake. */
function wrapMemberKey(memberSk, recipientPk, ctx) {
  const sk = key32(memberSk, 'the member key');
  const pk = key32(recipientPk, 'the recipient public key');
  return wrap(MEMBER_MAGIC, MEMBER_INFO, memberContext(ctx), sk, pk);
}

/** The member private key from a wrap, only if it derives to expectedPk; null on ANY failure. Never throws. */
function unwrapMemberKey(recipientSk, wrapped, ctx, expectedPk) {
  try {
    const sk = asBuf(recipientSk), want = asBuf(expectedPk);
    if (!sk || sk.length !== KEY_LEN || !want || want.length !== KEY_LEN) return null;
    const member = unwrap(MEMBER_MAGIC, MEMBER_INFO, memberContext(ctx), sk, wrapped);
    if (!member) return null;
    return crypto.timingSafeEqual(publicKeyOf(member), want) ? member : null;
  } catch { return null; }
}

/** Wrap one period's naming key to the member public key. Throws on a caller mistake. */
function wrapNamingKey(namingKey, memberPk, ctx) {
  const nk = key32(namingKey, 'the naming key');
  const pk = key32(memberPk, 'the member public key');
  return wrap(NAMING_MAGIC, NAMING_INFO, namingContext(ctx), nk, pk);
}

/** One period's naming key from its wrap, with the member private key; null on ANY failure. Never throws. */
function unwrapNamingKey(memberSk, wrapped, ctx) {
  try {
    const sk = asBuf(memberSk);
    if (!sk || sk.length !== KEY_LEN) return null;
    return unwrap(NAMING_MAGIC, NAMING_INFO, namingContext(ctx), sk, wrapped);
  } catch { return null; }
}

module.exports = {
  WRAP_LEN,
  newMemberKey,
  newNamingKey,
  wrapMemberKey,
  unwrapMemberKey,
  wrapNamingKey,
  unwrapNamingKey,
  // The associated-data bytes, exported for any other implementation of the unwrap service to match.
  memberContextBytes: memberContext,
  namingContextBytes: namingContext,
};
