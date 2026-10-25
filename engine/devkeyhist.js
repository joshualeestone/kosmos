'use strict';

/**
 * kosmos#7116 slice 1: the device-key history a restore takes a snapshot's signing key from, and its check.
 *
 * Why: a backup manifest is signed with the member's Mac key (backupdevicekey.js), and restore opens a manifest only
 * under the key that member's Mac had at the snapshot's time (backuprestore.js `devicePubAtSnapshot`, which "MUST come
 * from trusted state"). Today the only record of which key is whose is the coordinator's, so a breached coordinator can
 * name a key of its own, seal a manifest to the member's PUBLIC key and sign it, and restore would deliver its files as
 * the member's work (#5536 comment 6397036572). The history below is kept and signed by escrowd, not the coordinator.
 * Design v2 on #7116 (comment 6397107294). This slice is the format and the check only: nothing produces a history
 * yet, and nothing calls verify() outside its tests.
 *
 * The format. Per (org, member), escrowd keeps an append-only list of entries, each one of:
 *   { kind: 'enrol',  key, at, backfill }   a Mac key accepted for this member from time `at`
 *   { kind: 'revoke', key, at }             that key stops counting from time `at` (retired or lost)
 * `key` is the 32-byte Ed25519 public key in hex; `at` is escrowd's own clock, Unix seconds, never a time a Mac or the
 * coordinator supplied. `backfill` marks a key escrowd took from the coordinator's record at the switch-over, before
 * authenticated enrolment existed: true there, false otherwise, so a restore can say which kind it trusted.
 * The entries are chained: c0 = SHA-256(put(CHAIN_TAG) put(org) put(member)), then for each entry
 * c = SHA-256(put(c) put(kind byte: 1 enrol, 2 revoke) put(key) put(at, i64 BE) put(backfill byte: 1 or 0)), where
 * put is a u32 big-endian length then the bytes (as orgkeysig.js). escrowd signs the HEAD:
 * put(HEAD_TAG) put(org) put(member) put(count, u64 BE) put(issuedAt, i64 BE) put(chain).
 * As JSON, a revoke entry carries no `backfill` (absent or null; both encode as 0), an enrol entry carries true or false.
 *
 * What escrowd must uphold when it WRITES the log (slice 2), because the log is append-only and verify() refuses a
 * history that breaks any of these for good, leaving that member on the fingerprint pilot:
 *   - an entry's `at` is never earlier than the entry before it (clamp to it after a clock step back);
 *   - no entry is dated after the head that signs it;
 *   - a key is enrolled at most once, and revoked at most once and only after its enrol (refuse both at write time).
 *
 * What the head stops, and why it carries both a count and a fresh time:
 *   - the chain makes the entries one signed object, so a coordinator cannot hand over a subset (hiding a revoke);
 *   - `issuedAt` is escrowd's clock when it signed this head, and verify() refuses a head older than maxAgeSecs. An
 *     older head is a genuine signature over a shorter history, which is exactly how a revoke would be hidden by replay.
 * A revoke therefore takes effect on a Mac only once every head signed before it is older than maxAgeSecs: up to 24
 * hours (plus the clock allowance) in which a replayed earlier head still verifies.
 * What it does NOT stop, stated so nobody reads it as covered: a leaked key that was never revoked, and a manifest
 * signed by a revoked key with a time inside its validity window (the manifest's own time is the signer's word). The
 * caller passes a time it trusts more than the manifest's when it has one.
 *
 * Fails closed. Unlike orgkeypin.js (where a null VERIFYING_KEY means "check nothing, answer ok"), a missing verifying
 * key here is a refusal: a restore that cannot check the history must fall back to the person confirming the
 * fingerprint (the pilot, #5536), never to the coordinator's word. VERIFYING_KEY is null until escrowd's history key is
 * on the production box; it is derived from the escrow key under its own HKDF label, separate from the org-key signer.
 *
 * verify(history, opts) never throws. history: { org, member, entries, issuedAt, signature (base64url) }.
 * opts: { org, member (REQUIRED: the member being restored; a genuine history for anyone else is refused),
 *   now (Unix seconds), maxAgeSecs, skewSecs (each can only narrow the default window) }.
 * There is no option for the verifying key: a caller handing one in would become the trust anchor. Tests set one with
 * setVerifyingKeyForTests(), which counts only inside a node test process and never once VERIFYING_KEY ships.
 * Answers { ok: true, keys } with keys [{ key, from, until (null while valid), backfill }], or { ok: false, because }.
 * keyAt(keys, key, t) answers the entry under which `key` (lowercase hex, as the history holds it) was valid at time `t`,
 * or null.
 */

const crypto = require('node:crypto');

const HEAD_TAG = Buffer.from('kosmos-escrowd-devkeyhist head v1');
const CHAIN_TAG = Buffer.from('kosmos-escrowd-devkeyhist chain v1');
// escrowd's device-key-history verification key (32 raw bytes, hex). null until it ships: verify() then REFUSES.
const VERIFYING_KEY = null;
const MAX_AGE_SECS = 24 * 3600;
const SKEW_SECS = 300;
const MAX_ENTRIES = 4096;
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const KEY_RE = /^[0-9a-f]{64}$/;
let verifyingKeyForTests = null;

function put(parts, field) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(field.length);
  parts.push(len, field);
}
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; }
const sha256 = (parts) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest();

// Canonical base64url only (as orgkeypin.js): Node's decoder skips characters it does not know.
function unb64(s) {
  if (typeof s !== 'string') return null;
  const b = Buffer.from(s, 'base64url');
  return b.toString('base64url') === s ? b : null;
}

const isTime = (t) => Number.isSafeInteger(t) && t >= 0;

/* The chain over `entries`, or null when an entry is not one escrowd could have written. */
function chain(org, member, entries) {
  let parts = [];
  put(parts, CHAIN_TAG);
  put(parts, Buffer.from(org, 'utf8'));
  put(parts, Buffer.from(member, 'utf8'));
  let c = sha256(parts);
  for (const e of entries) {
    if (!e || typeof e !== 'object') return null;
    const kind = e.kind === 'enrol' ? 1 : e.kind === 'revoke' ? 2 : 0;
    if (!kind || typeof e.key !== 'string' || !KEY_RE.test(e.key) || !isTime(e.at)) return null;
    if (kind === 1 && typeof e.backfill !== 'boolean') return null;
    if (kind === 2 && e.backfill !== undefined && e.backfill !== null) return null;
    parts = [];
    put(parts, c);
    put(parts, Buffer.from([kind]));
    put(parts, Buffer.from(e.key, 'hex'));
    put(parts, i64(e.at));
    put(parts, Buffer.from([kind === 1 && e.backfill ? 1 : 0]));
    c = sha256(parts);
  }
  return c;
}

/* The signed head bytes, or null when an input is not what escrowd could have signed. */
function encodeHead(org, member, entries, issuedAt) {
  // Well-formed only: UTF-8 encoding turns a lone surrogate into U+FFFD, so two different ids could sign as one.
  if (typeof org !== 'string' || !org || !org.isWellFormed() || typeof member !== 'string' || !member || !member.isWellFormed()) return null;
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES || !isTime(issuedAt)) return null;
  const c = chain(org, member, entries);
  if (!c) return null;
  const parts = [];
  put(parts, HEAD_TAG);
  put(parts, Buffer.from(org, 'utf8'));
  put(parts, Buffer.from(member, 'utf8'));
  put(parts, u64(entries.length));
  put(parts, i64(issuedAt));
  put(parts, c);
  return Buffer.concat(parts);
}

/* The keys the entries establish, or a refusal reason. Order is the log's order; times never go backwards, and no
   entry is dated after the head that signed it. */
function replay(entries, issuedAt) {
  const keys = new Map();
  let last = -1;
  for (const e of entries) {
    if (e.at < last) return 'an entry in the device key history is dated before the one above it';
    if (e.at > issuedAt) return 'an entry in the device key history is dated after escrowd signed it';
    last = e.at;
    const k = keys.get(e.key);
    if (e.kind === 'enrol') {
      // A key enrolled once stays one entry: re-enrolling a revoked key would bring a retired key back to life.
      if (k) return 'the device key history enrols the same key twice';
      keys.set(e.key, { key: e.key, from: e.at, until: null, backfill: e.backfill });
    } else {
      if (!k) return 'the device key history revokes a key it never enrolled';
      if (k.until !== null) return 'the device key history revokes the same key twice';
      k.until = e.at;
    }
  }
  return [...keys.values()];
}

function verify(history, opts = {}) {
  try {
    // The shipped key, once there is one, is the only key. Until then only a test process has one; production REFUSES
    // (the difference from orgkeypin.js, on purpose).
    const vk = VERIFYING_KEY != null ? Buffer.from(VERIFYING_KEY, 'hex') : process.env.NODE_TEST_CONTEXT ? verifyingKeyForTests : null;
    if (vk == null) return { ok: false, because: 'this version of Kosmos cannot check the device key history yet, so the key was not trusted' };
    // Read every field once, into a copy: what is hashed is exactly what is replayed.
    const h = history && typeof history === 'object' ? history : {};
    const org = h.org;
    const member = h.member;
    const issuedAt = h.issuedAt;
    const signature = h.signature;
    const raw = h.entries;
    const entries = Array.isArray(raw) && raw.length <= MAX_ENTRIES
      ? Array.from(raw, (e) => (e && typeof e === 'object' ? { kind: e.kind, key: e.key, at: e.at, backfill: e.backfill } : e))
      : null;
    // A genuine history for ANOTHER member is still escrowd's signature; it must be the member being restored.
    if (typeof opts.org !== 'string' || !opts.org || typeof opts.member !== 'string' || !opts.member) {
      return { ok: false, because: 'the device key history was checked without naming the member it must belong to' };
    }
    if (org !== opts.org || member !== opts.member) return { ok: false, because: 'the device key history names a different member' };
    const sig = unb64(signature);
    const msg = encodeHead(org, member, entries, issuedAt);
    if (!msg || !sig || sig.length !== 64) return { ok: false, because: 'the device key history was not in the form escrowd signs' };
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, vk]), format: 'der', type: 'spki' });
    if (crypto.verify(null, msg, key, sig) !== true) return { ok: false, because: 'escrowd\'s signature on the device key history did not check' };
    // A clock that is not a time is the caller's mistake: refused by name, never left to whichever check it trips.
    if (opts.now !== undefined && !isTime(opts.now)) return { ok: false, because: 'the device key history was checked against a clock that is not a time' };
    const now = opts.now !== undefined ? opts.now : Math.floor(Date.now() / 1000);
    // A caller may narrow the freshness window, never widen it: freshness is what stops a replayed shorter history.
    // A window that is not a number of seconds is refused, never read as "use the default".
    if (opts.maxAgeSecs !== undefined && !(Number.isSafeInteger(opts.maxAgeSecs) && opts.maxAgeSecs > 0)) return { ok: false, because: 'the device key history was checked with a freshness window that is not a number of seconds' };
    if (opts.skewSecs !== undefined && !isTime(opts.skewSecs)) return { ok: false, because: 'the device key history was checked with a clock allowance that is not a number of seconds' };
    const maxAge = opts.maxAgeSecs !== undefined ? Math.min(opts.maxAgeSecs, MAX_AGE_SECS) : MAX_AGE_SECS;
    const skew = opts.skewSecs !== undefined ? Math.min(opts.skewSecs, SKEW_SECS) : SKEW_SECS;
    if (issuedAt > now + skew) return { ok: false, because: 'the device key history is dated in the future' };
    if (now - issuedAt > maxAge) return { ok: false, because: 'the device key history is too old to trust; a fresh one is needed' };
    const keys = replay(entries, issuedAt);
    if (typeof keys === 'string') return { ok: false, because: keys };
    return { ok: true, keys };
  } catch {
    return { ok: false, because: 'the device key history could not be checked' };
  }
}

function setVerifyingKeyForTests(k) { verifyingKeyForTests = Buffer.isBuffer(k) && k.length === 32 ? k : null; }

function keyAt(keys, key, t) {
  if (!Array.isArray(keys) || typeof key !== 'string' || !KEY_RE.test(key) || !isTime(t)) return null;
  return keys.find((k) => k.key === key && t >= k.from && (k.until === null || t < k.until)) || null;
}

module.exports = { verify, keyAt, encodeHead, setVerifyingKeyForTests, VERIFYING_KEY, HEAD_TAG, CHAIN_TAG };
