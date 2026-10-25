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
 *
 * What the head stops, and why it carries both a count and a fresh time:
 *   - the chain makes the entries one signed object, so a coordinator cannot hand over a subset (hiding a revoke);
 *   - `issuedAt` is escrowd's clock when it signed this head, and verify() refuses a head older than maxAgeSecs. An
 *     older head is a genuine signature over a shorter history, which is exactly how a revoke would be hidden by replay.
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
 * opts: { verifyingKey (32-byte Buffer; stands in for VERIFYING_KEY), now (Unix seconds), maxAgeSecs, skewSecs }.
 * Answers { ok: true, keys } with keys [{ key, from, until (null while valid), backfill }], or { ok: false, because }.
 * keyAt(keys, key, t) answers the entry under which `key` was valid at time `t`, or null.
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
    if (kind === 2 && e.backfill !== undefined) return null;
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
  if (typeof org !== 'string' || !org || typeof member !== 'string' || !member) return null;
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

/* The keys the entries establish, or a refusal reason. Order is the log's order; times never go backwards. */
function replay(entries) {
  const keys = new Map();
  let last = -1;
  for (const e of entries) {
    if (e.at < last) return 'an entry in the device key history is dated before the one above it';
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
    // Only a real 32-byte key counts; null or anything else REFUSES (the difference from orgkeypin.js, on purpose).
    const vk = Buffer.isBuffer(opts.verifyingKey) && opts.verifyingKey.length === 32 ? opts.verifyingKey : VERIFYING_KEY == null ? null : Buffer.from(VERIFYING_KEY, 'hex');
    if (vk == null) return { ok: false, because: 'this version of Kosmos cannot check the device key history yet, so the key was not trusted' };
    const h = history || {};
    const sig = unb64(h.signature);
    const msg = encodeHead(h.org, h.member, h.entries, h.issuedAt);
    if (!msg || !sig || sig.length !== 64) return { ok: false, because: 'the device key history was not in the form escrowd signs' };
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, vk]), format: 'der', type: 'spki' });
    if (crypto.verify(null, msg, key, sig) !== true) return { ok: false, because: 'escrowd\'s signature on the device key history did not check' };
    const now = Number.isSafeInteger(opts.now) ? opts.now : Math.floor(Date.now() / 1000);
    const maxAge = Number.isSafeInteger(opts.maxAgeSecs) && opts.maxAgeSecs > 0 ? opts.maxAgeSecs : MAX_AGE_SECS;
    const skew = Number.isSafeInteger(opts.skewSecs) && opts.skewSecs >= 0 ? opts.skewSecs : SKEW_SECS;
    if (h.issuedAt > now + skew) return { ok: false, because: 'the device key history is dated in the future' };
    if (now - h.issuedAt > maxAge) return { ok: false, because: 'the device key history is too old to trust; a fresh one is needed' };
    const keys = replay(h.entries);
    if (typeof keys === 'string') return { ok: false, because: keys };
    return { ok: true, keys };
  } catch {
    return { ok: false, because: 'the device key history could not be checked' };
  }
}

function keyAt(keys, key, t) {
  if (!Array.isArray(keys) || typeof key !== 'string' || !isTime(t)) return null;
  return keys.find((k) => k.key === key && t >= k.from && (k.until === null || t < k.until)) || null;
}

module.exports = { verify, keyAt, encodeHead, VERIFYING_KEY, HEAD_TAG, CHAIN_TAG };
