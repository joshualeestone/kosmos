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
 * Wraps:  member key  KBK1 | enc(32) | ct(32 + 16)
 *         naming key  KBN1 | enc(32) | ct(32 + 16)      both with HPKE info "kosmos-backup v1 key-wrap"
 * Distinct magic AND a context line that names its kind: a member-key wrap can never open as a naming key.
 *
 * Wraps are NOT authenticated (HPKE base mode): anyone with a recipient's public key can make one that opens. So
 * every unwrap is anchored to a value from an AUTHENTICATED source, never from key storage or a record kept beside
 * the wrap (whoever can write there could supply a forged wrap and a matching value together):
 *   - unwrapMemberKey REQUIRES the public key the result must derive to, taken from the coordinator-signed policy
 *     bundle (decision 7). A wrap of the wrong key (a forgery, a wrapper bug, another epoch's key under this
 *     context) is refused.
 *   - The check is equality of PUBLIC keys, so it holds up to X25519 clamping: a secret differing only in clamped
 *     bits is the same key and passes. The bytes returned are the bytes that were wrapped; code that hashes,
 *     fingerprints or compares raw secret bytes must not assume one form (see unwrapMemberKey).
 *   - unwrapNamingKey REQUIRES the naming-key id, taken from the device-SIGNED, verified manifest. A forged naming
 *     key cannot have that id, so it is refused outright.
 *
 * unwrapNamingKey is for RESTORE only. Restore must also take every chunk NAME from that signed manifest: chunks
 * are HPKE-sealed too, so anyone with the member public key can forge one, and only a name fixed by the manifest
 * makes a match a preimage search against the HMAC. A restore path that listed names from storage would not be safe.
 *
 * A Mac must NEVER unwrap a naming key from storage to name NEW chunks: a forged one would make those names
 * predictable to whoever forged it. A Mac that lost its naming key mid-period makes a fresh one (newNamingKey), at
 * the cost of deduplication within that period. A period can then hold more than one naming key under one context,
 * so each manifest records namingKeyId(nk), and restore passes that id. If a stored wrap is ever reused for new
 * data, it first needs an authenticator (a device signature, or carrying it inside the device-signed manifest).
 *
 * Context ids are STRINGS of letters, digits and . _ : - (1 to 128): epoch '1' and '01' are different contexts, and
 * a number throws on wrap and reads as null on unwrap, so whatever stores them must write one canonical form.
 *
 * wrap* throw on a caller mistake (a key that is not 32 bytes, a bad context, a non-canonical recipient key, which
 * hpke.js refuses because it could never be opened). unwrap* return null on ANY failure and never throw, as hpke.js
 * and backupformat.js do.
 *
 * Secrets come back as fresh Buffers (never views over an input), so a caller may zero them; Node cannot reliably
 * zero memory, and this module does not try. A small Buffer usually sits in Node's shared pool, so its .buffer is a
 * larger slab: copy into Buffer.alloc(32) before handing .buffer anywhere.
 *
 * Not here: where keys and wraps are stored, the org key pair and escrow, delivering the member public key in the
 * coordinator-signed policy bundle (decision 7), rotation policy, and the walker.
 */
const crypto = require('crypto');
const { hpkeSeal, hpkeOpen, hpkeKeyPair } = require('./hpke');

const FORMAT = 1;
const KEY_LEN = 32, ENC_LEN = 32;
const MEMBER_MAGIC = Buffer.from('KBK1');   // Kosmos Backup Key: a wrapped member private key, format 1
const NAMING_MAGIC = Buffer.from('KBN1');   // Kosmos Backup Naming key, wrapped, format 1
// One HPKE info for both kinds: what separates them is the magic and the kind line in the associated data.
const INFO = Buffer.from(`kosmos-backup v${FORMAT} key-wrap`);
const MEMBER_FIELDS = ['org', 'member', 'epoch'];
const NAMING_FIELDS = ['org', 'member', 'epoch', 'period'];
// backupformat.js's id alphabet: a lone surrogate would become U+FFFD in the bytes (two contexts, one byte string),
// and a newline could forge a field.
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

const asBuf = (x) => (Buffer.isBuffer(x) ? x : (x instanceof Uint8Array ? Buffer.from(x) : null));

/* The associated data for one kind of wrap: a fixed line naming the kind, then each field. Throws on a bad ctx. */
function contextBytes(kind, fields, ctx) {
  // Each value is read ONCE, then checked and used: a getter could not pass the check and then return a newline.
  const vals = fields.map((k) => (ctx && Object.hasOwn(ctx, k) ? ctx[k] : undefined));
  fields.forEach((k, i) => {
    if (typeof vals[i] !== 'string' || !ID_RE.test(vals[i])) throw new Error(`backupkeys: the ${kind} context needs a non-empty ${k} of letters, digits and . _ : -`);
  });
  return Buffer.from(`kosmos-backup v${FORMAT} ${kind}\n` + fields.map((k, i) => `${k}=${vals[i]}`).join('\n'));
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

// A naming key's id: a domain-tagged SHA-256, first 16 bytes, hex. It reveals nothing about a random key, and lets
// a manifest say WHICH of a period's naming keys names its chunks (a period can hold more than one, see the header).
const NAMING_ID_TAG = Buffer.from(`kosmos-backup v${FORMAT} naming-key-id\0`);
/** The id of a naming key (32 LOWERCASE hex characters; an upper-case id never matches), for a manifest to record
    and restore to match. Throws on a bad key. */
function namingKeyId(namingKey) {
  const nk = key32(namingKey, 'the naming key');
  return crypto.createHash('sha256').update(NAMING_ID_TAG).update(nk).digest().subarray(0, 16).toString('hex');
}

function wrap(magic, info, aad, secret, recipientPk) {
  let sealed;
  try { sealed = hpkeSeal(recipientPk, info, aad, secret); } catch (err) {
    // hpke.js names a non-canonical key itself; anything else (a low-order key OpenSSL refuses) gets a sentence here.
    if (/canonical/.test(String(err && err.message))) throw err;
    throw new Error('backupkeys: the recipient public key is not usable (a low-order or malformed X25519 key)');
  }
  return Buffer.concat([magic, sealed.enc, sealed.ct]);
}
function unwrap(magic, info, aad, recipientSk, wrapped) {
  const w = asBuf(wrapped);
  if (!w || w.length < 4 + ENC_LEN || !w.subarray(0, 4).equals(magic)) return null;
  const out = hpkeOpen(recipientSk, w.subarray(4, 4 + ENC_LEN), info, aad, w.subarray(4 + ENC_LEN));
  // HPKE base mode is not authenticated: anyone holding the recipient's public key can make a wrap that opens.
  // So the secret's length is checked here (a forged wrap of 31 bytes must not become a key), and a member key must
  // also derive to the expected public key (unwrapMemberKey).
  return out && out.length === KEY_LEN ? out : null;
}

/** Wrap a member backup private key to one X25519 public key (org, device or destination). Throws on a caller mistake. */
function wrapMemberKey(memberSk, recipientPk, ctx) {
  const sk = key32(memberSk, 'the member key');
  const pk = key32(recipientPk, 'the recipient public key');
  return wrap(MEMBER_MAGIC, INFO, memberContext(ctx), sk, pk);
}

/** The member private key from a wrap, only if it derives to expectedPk (from an authenticated source, see the
    header); null on ANY failure. Never throws. CONTRACT: the bytes returned are the bytes that were wrapped, and a
    secret differing only in X25519-clamped bits derives to the same public key, so never fingerprint, compare or
    de-duplicate the RAW secret bytes; compare public keys. */
function unwrapMemberKey(recipientSk, wrapped, ctx, expectedPk) {
  try {
    const sk = asBuf(recipientSk), want = asBuf(expectedPk);
    if (!sk || sk.length !== KEY_LEN || !want || want.length !== KEY_LEN) return null;
    const member = unwrap(MEMBER_MAGIC, INFO, memberContext(ctx), sk, wrapped);
    if (!member) return null;
    return crypto.timingSafeEqual(publicKeyOf(member), want) ? member : null;
  } catch { return null; }
}

/** Wrap one period's naming key to the member public key. Throws on a caller mistake. */
function wrapNamingKey(namingKey, memberPk, ctx) {
  const nk = key32(namingKey, 'the naming key');
  const pk = key32(memberPk, 'the member public key');
  return wrap(NAMING_MAGIC, INFO, namingContext(ctx), nk, pk);
}

/** One period's naming key from its wrap, with the member private key, FOR RESTORE ONLY (see the header), and only
    if its namingKeyId is expectedId (REQUIRED: the id the signed manifest records). A forged naming key cannot have
    the manifest's id, so it is refused here rather than failing chunk names later, and among several wraps for one
    period only the manifest's key opens. null on ANY failure. Never throws. */
function unwrapNamingKey(memberSk, wrapped, ctx, expectedId) {
  try {
    const sk = asBuf(memberSk);
    if (!sk || sk.length !== KEY_LEN || typeof expectedId !== 'string' || !/^[0-9a-f]{32}$/.test(expectedId)) return null;
    const nk = unwrap(NAMING_MAGIC, INFO, namingContext(ctx), sk, wrapped);
    return nk && crypto.timingSafeEqual(Buffer.from(namingKeyId(nk)), Buffer.from(expectedId)) ? nk : null;
  } catch { return null; }
}

module.exports = {
  newMemberKey,
  newNamingKey,
  namingKeyId,
  wrapMemberKey,
  unwrapMemberKey,
  wrapNamingKey,
  unwrapNamingKey,
  // The associated-data bytes, exported for any other implementation of the unwrap service to match.
  memberContextBytes: memberContext,
  namingContextBytes: namingContext,
};
