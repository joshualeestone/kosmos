'use strict';
/**
 * kosmos#6587 (S-7a, slice 1): the Kosmos+ SERVICE KEY SET, checked on this computer.
 *
 * Every Kosmos+ token is signed by the service key, and this computer's tunnel pins one such key at setup (the
 * remote state dir's coordinator_pubkey), first use only. A service key set is a short list of the service keys that
 * are genuine, signed by the offline Kosmos recovery key (the one that signs the release key list, kosmos#6609), and
 * shipped inside the signed release. With it, a computer can tell that the key it pinned is one Kosmos vouches for,
 * which also catches a past first-use compromise (a key planted at setup), not only a future one.
 *
 * The format and every rule are kosmos-relay's (relay #474, crates/proto/src/keyset.rs, docs/token-format.md
 * "Service key set"), and this file checks the same way, against the same test vectors:
 *
 *   service-keys.json      {"type": "kosmos-service-keys", "service_keys": [{"kid", "pub", "role"}, ...],
 *                          "seq": <n>, "issued": "<YYYY-MM-DD>"}
 *   service-keys.json.sig  the recovery key's Ed25519 signature over that file's EXACT bytes, base64
 *
 * This slice only CHECKS. It is off while engine/manifest-verify.js RECOVERY_KEYS is empty (as it ships today): the
 * check answers { off: true } and verifies nothing, and nothing here is called from the board yet. Its later slices: the release
 * ships the set, and the board compares the pinned key with it and tells the person on a mismatch.
 */
const crypto = require('node:crypto');
// The recovery keys are the release key list's (kosmos#6609): one pinned list, so turning the feature on is one change.
const { RECOVERY_KEYS } = require('./manifest-verify');

const SERVICE_KEYS_TYPE = 'kosmos-service-keys';
const MAX_SEQ = 2147483647;
const MAX_SERVICE_KEYS = 3;
const ROLES = new Set(['current', 'next', 'retiring']);
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const RUST_WS = new Set([...'\t\n\v\f\r \u0085\u00a0\u1680\u2028\u2029\u202f\u205f\u3000']);
for (let c = 0x2000; c <= 0x200a; c += 1) RUST_WS.add(String.fromCharCode(c));
// str::trim, in linear time: a regex for the trailing run backtracks quadratically over a long run inside the text.
const rustTrim = (s) => {
  let a = 0;
  let b = s.length;
  while (a < b && RUST_WS.has(s[a])) a += 1;
  while (b > a && RUST_WS.has(s[b - 1])) b -= 1;
  return s.slice(a, b);
};

/* The small-order (weak) Ed25519 points, as libsodium lists them. A point is weak when it equals one of these in its
   first 31 bytes and in the low 7 bits of the last (the sign bit is ignored, so both spellings of each are caught).
   kosmos-relay refuses these keys (ed25519-dalek is_weak), so a set naming one is refused here too. */
const WEAK = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
].map((h) => Buffer.from(h, 'hex'));
function weak(raw) {
  return WEAK.some((w) => w.subarray(0, 31).equals(raw.subarray(0, 31)) && (w[31] & 0x7f) === (raw[31] & 0x7f));
}

/* A point on the curve: ed25519-dalek's decompression accepts y (its low 255 bits, taken mod p) when (y^2 - 1) /
   (d y^2 + 1) is zero or a square mod p, and refuses the key otherwise. Node's createPublicKey takes any 32 bytes. */
const P = 2n ** 255n - 19n;
const modPow = (b, e) => { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; } return r; };
const D = ((P - 121665n) * modPow(121666n, P - 2n)) % P;
function onCurve(raw) {
  let y = 0n;
  for (let i = 31; i >= 0; i -= 1) y = (y << 8n) | BigInt(i === 31 ? raw[i] & 0x7f : raw[i]);
  y %= P;
  const y2 = (y * y) % P;
  const x2 = (((y2 - 1n + P) % P) * modPow((D * y2 + 1n) % P, P - 2n)) % P;
  return x2 === 0n || modPow(x2, (P - 1n) / 2n) === 1n;
}

/** The raw 32-byte key of a canonical, non-weak Ed25519 SPKI base64 string, or null. Only the canonical spelling is a
 * key (re-encoding gives the same string), so comparing strings compares keys. */
function rawKey(spkiB64) {
  if (typeof spkiB64 !== 'string' || !/^[A-Za-z0-9+/]{59}=$/.test(spkiB64)) return null;
  const der = Buffer.from(spkiB64, 'base64');
  if (der.length !== 44 || der.toString('base64') !== spkiB64 || !der.subarray(0, 12).equals(SPKI_PREFIX)) return null;
  const raw = der.subarray(12);
  return weak(raw) || !onCurve(raw) ? null : Buffer.from(raw);
}
const spkiOf = (raw) => Buffer.concat([SPKI_PREFIX, raw]).toString('base64');
const keyObject = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });

/** A key's kid: base64url, no padding, of the first 8 bytes of sha256 over the RAW 32-byte key. */
function kidOf(raw) {
  return crypto.createHash('sha256').update(raw).digest().subarray(0, 8).toString('base64url');
}

/** The pinned coordinator key (base64url of the 32 raw bytes, as the tunnel writes coordinator_pubkey) as its SPKI
 * base64 spelling, the one a set lists; null for anything else. */
function pinnedSpki(pinned) {
  if (pinned != null && typeof pinned !== 'string' && !Buffer.isBuffer(pinned)) return null;   // not text: no key, never a throw
  const s = rustTrim(String(pinned == null ? '' : pinned));   // as the tunnel trims it (str::trim)
  if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return null;
  const raw = Buffer.from(s, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== s) return null;
  return spkiOf(raw);
}

/* JSON.parse keeps the last of two same-named members without a word, and turns 1.0 and 1e0 into the integer 1;
   serde_json (relay) refuses a duplicate here and a non-integer seq. So the bytes are walked once more: member names
   compared after unescaping, at any depth, and the raw spelling of each top-level number kept. Called only on text
   that JSON.parse accepted, so the walk needs no error reporting of its own beyond the duplicate. */
function scan(text) {
  let i = 0;
  const top = {};
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i += 1; };
  const str = () => {
    const start = i; i += 1;
    // Bounded by the length too: the text already parsed, but a walk that could run past its end must not hang.
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) throw new Error('holds a string that does not end');
    i += 1;
    const s = JSON.parse(text.slice(start, i));
    // A lone surrogate (only an escape can make one here: the bytes were strict UTF-8) is refused by serde_json.
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(s)) throw new Error('holds a lone surrogate');
    return s;
  };
  const value = (depth) => {
    ws();
    const c = text[i];
    // serde_json's recursion limit: 127 nested arrays and objects, the outermost counted.
    if ((c === '{' || c === '[') && depth >= 127) throw new Error('is nested too deeply');
    if (c === '{') {
      i += 1; const names = new Set(); ws();
      if (text[i] === '}') { i += 1; return undefined; }
      for (;;) {
        ws(); const name = str();
        if (names.has(name)) throw new Error('names the member "' + name + '" twice');
        names.add(name);
        ws(); i += 1;   // the colon
        const raw = value(depth + 1);
        if (depth === 0) top[name] = raw;
        ws();
        if (text[i] === ',') { i += 1; continue; }
        i += 1; return undefined;   // the closing brace
      }
    }
    if (c === '[') {
      i += 1; ws();
      if (text[i] === ']') { i += 1; return undefined; }
      for (;;) { value(depth + 1); ws(); if (text[i] === ',') { i += 1; continue; } i += 1; return undefined; }
    }
    if (c === '"') { str(); return undefined; }
    const start = i;
    while (i < text.length && !',}] \t\n\r'.includes(text[i])) i += 1;
    const raw = text.slice(start, i);   // a number, true, false or null, as spelled
    // serde_json refuses a number out of a double's range (1e400); JSON.parse would read Infinity.
    if (raw !== 'true' && raw !== 'false' && raw !== 'null' && !Number.isFinite(Number(raw))) throw new Error('holds a number out of range');
    return raw;
  };
  value(0);
  return top;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function realDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4)); const m = Number(s.slice(5, 7)); const d = Number(s.slice(8, 10));
  if (y === 0 || m < 1 || m > 12 || d === 0) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= (m === 2 && leap ? 29 : DAYS[m - 1]);
}

/**
 * Checks a service key set's bytes and signature, the recovery key's signature over the exact bytes first (as the
 * relay), then JSON with no member named twice, the type, seq and issued, the keys, and seq against `held` (the
 * relay checks field shapes before seq and issued, so a document refused on both sides may give another reason) (the
 * { seq, sha256 } this computer took last, or null). Returns { ok: true, seq, sha256, keys: [{ kid, pub, role }] },
 * { ok: false, why }, or, when no recovery key is pinned, { ok: false, off: true, why }. A caller checks `off` BEFORE
 * `ok`: off is the shipped default and is not a failure to tell anyone about.
 */
function verifyServiceKeySet(opts) {
  // Anything for the options (null included) is read, never thrown on: a refusal is the answer to bad input.
  const { bytes, sig, recoveryKeys = RECOVERY_KEYS, held = null } = opts && typeof opts === 'object' ? opts : {};
  // Off (no recovery key pinned, as shipped today) is its own answer, not a refusal: a caller must not tell the
  // person a set failed when there is simply nothing to check it with.
  // Only an empty LIST is off. Anything else (a null or junk from a bad read) is refused, never read as "nothing to do".
  if (!Array.isArray(recoveryKeys)) return { ok: false, why: 'the Kosmos recovery keys are not a list' };
  if (!recoveryKeys.length) return { ok: false, off: true, why: 'no Kosmos recovery key is set, so service key sets are not checked yet' };
  if (bytes != null && !Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array) && typeof bytes !== 'string') {
    return { ok: false, why: 'the service key set is not readable' };
  }
  if (sig != null && !Buffer.isBuffer(sig) && !(sig instanceof Uint8Array) && typeof sig !== 'string') {
    return { ok: false, why: 'the signature is not readable' };
  }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes == null ? '' : bytes);
  // Trimmed as Rust's str::trim does (Unicode White_Space: U+0085 yes, U+FEFF no), not as String.prototype.trim.
  const sigText = rustTrim(sig == null ? '' : Buffer.isBuffer(sig) || sig instanceof Uint8Array ? Buffer.from(sig).toString() : String(sig));
  // Strict base64, as the relay's decoder: padded, and canonical (re-encoding gives the same text, so no trailing bits).
  let signature = /^[A-Za-z0-9+/]{86}==$/.test(sigText) ? Buffer.from(sigText, 'base64') : Buffer.alloc(0);
  if (signature.toString('base64') !== sigText) signature = Buffer.alloc(0);
  const roots = recoveryKeys.map(rawKey).filter(Boolean);
  // The root that signed it: the relay refuses a set listing ITS root (keyset.rs check_keys), not any other.
  const signer = signature.length === 64 ? roots.find((r) => {
    try { return crypto.verify(null, buf, keyObject(r), signature); } catch { return false; }
  }) : undefined;
  if (!signer) return { ok: false, why: 'the service key set is not signed by the Kosmos recovery key' };
  let doc; let top;
  let text;
  // Strict UTF-8, as serde_json reads bytes (toString would swap a bad byte for U+FFFD). A BOM is kept, so JSON.parse
  // refuses it, as the relay does.
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf); } catch { return { ok: false, why: 'the signed service key set is not readable' }; }
  try { doc = JSON.parse(text); } catch { return { ok: false, why: 'the signed service key set is not readable' }; }
  try { top = scan(text); } catch (e) { return { ok: false, why: 'the signed service key set ' + e.message }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.type !== SERVICE_KEYS_TYPE) {
    return { ok: false, why: 'the signed file is not a service key set' };
  }
  if (!/^[1-9]\d{0,9}$/.test(top.seq || '') || Number(top.seq) > MAX_SEQ) {
    return { ok: false, why: 'the signed service key set has no valid sequence number' };
  }
  const seq = Number(top.seq);
  if (!realDate(doc.issued)) return { ok: false, why: 'the signed service key set has no valid issue date' };
  const entries = doc.service_keys;
  if (!Array.isArray(entries) || !entries.length) return { ok: false, why: 'the signed service key set names no key' };
  if (entries.length > MAX_SERVICE_KEYS) return { ok: false, why: 'the signed service key set names more than ' + MAX_SERVICE_KEYS + ' keys' };
  const keys = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object' || typeof e.kid !== 'string' || typeof e.pub !== 'string' || !ROLES.has(e.role)) {
      return { ok: false, why: 'the signed service key set holds an entry that is not one' };
    }
    const raw = rawKey(e.pub);
    if (!raw) return { ok: false, why: 'the signed service key set holds a key that is not one' };
    if (e.kid !== kidOf(raw)) return { ok: false, why: 'the signed service key set names a key under another kid' };
    // Any pinned recovery key, not only the signer: whoever held a listed key would hold a root (manifest-verify agrees).
    if (roots.some((r) => r.equals(raw))) return { ok: false, why: 'the signed service key set lists the recovery key as a service key' };
    if (keys.some((k) => k.pub === e.pub)) return { ok: false, why: 'the signed service key set lists a key twice' };
    keys.push({ kid: e.kid, pub: e.pub, role: e.role });
  }
  if (keys.filter((k) => k.role === 'current').length !== 1) {
    return { ok: false, why: 'the signed service key set does not name exactly one current key' };
  }
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  if (held != null) {
    // A record that cannot be read as one fails closed: skipping it would let an older set back in.
    if (typeof held !== 'object' || !Number.isInteger(held.seq) || held.seq < 1 || held.seq > MAX_SEQ || typeof held.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(held.sha256)) {
      return { ok: false, why: 'the service key set this computer holds is not readable, so no other is taken' };
    }
    if (seq < held.seq) return { ok: false, why: `the service key set is older (${seq}) than the one this computer holds (${held.seq})` };
    if (seq === held.seq && sha256 !== held.sha256) return { ok: false, why: `the service key set reuses sequence number ${seq} with other contents` };
  }
  return { ok: true, seq, sha256, keys };
}

/** Whether a pinned coordinator key (as coordinator_pubkey holds it) is on a set: true or false only for a set that
 * VERIFIED (a verifyServiceKeySet result with ok: true) and a pin that is there; null for off, a refused set, or no
 * pin, because "not on the list" must never be read off a list nobody checked or a pin nobody set. A pin that is there
 * but is not a key is false: a mismatch. */
function pinnedIsListed(pinned, verified) {
  if (!verified || verified.ok !== true || !Array.isArray(verified.keys)) return null;
  // A pin that is not text (junk from a failed read) is no answer, as junk recovery keys are refused (iteration 13).
  if (pinned != null && typeof pinned !== 'string' && !Buffer.isBuffer(pinned)) return null;
  // No pin yet (before setup, or an empty file) is not a mismatch either: nothing was pinned to compare.
  if (rustTrim(String(pinned == null ? '' : pinned)) === '') return null;
  const spki = pinnedSpki(pinned);
  return !!spki && verified.keys.some((k) => k && k.pub === spki);
}

module.exports = { SERVICE_KEYS_TYPE, MAX_SEQ, MAX_SERVICE_KEYS, verifyServiceKeySet, pinnedIsListed, pinnedSpki, kidOf, rawKey };
