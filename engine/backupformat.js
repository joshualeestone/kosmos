/**
 * kosmos#5535 (E0.6, Enterprise backup) slice 2, the pure half: the bytes a backup is made of.
 * No I/O, no network, no keys on disk: the snapshot walker (slice 3) and restore (slice 4) call these.
 * Design v2 / v2.1 on #5535 (two blind review rounds) fixes every rule here; this file only implements them.
 *
 *  - Content-defined chunking (a gear rolling hash, FastCDC-style normalized masks): an edit near the start
 *    of a file moves at most a chunk or two, so the rest dedups within the period.
 *  - Chunk NAME = HMAC-SHA256(period naming key, plaintext). It never leaves the manifest and the AEAD's
 *    associated data; storage sees only the coordinator's random object key (v2.1 item 7).
 *  - Chunk OBJECT = HPKE-sealed (engine/hpke.js) to the member's backup public key, with the chunk name as
 *    associated data, so a chunk stored under the wrong name does not open (v2 "integrity").
 *    The plaintext inside is length-framed and padded to a Padme bucket (at most about 12% overhead), so an
 *    object's size does not reveal the exact size of what it holds.
 *  - MANIFEST = canonical JSON, HPKE-sealed the same way (associated data: the snapshot context), and SIGNED
 *    by the member device's Ed25519 key over the sealed bytes and the context. The coordinator can check
 *    the signature and record the hash at grant time without decrypting anything.
 *
 * Every open/verify returns null on ANY failure and never throws, as hpke.js and fedseal.js do.
 */
const crypto = require('crypto');
const { hpkeSeal, hpkeOpen } = require('./hpke');

const FORMAT = 1;
const CHUNK_MAGIC = Buffer.from('KBC1');     // Kosmos Backup Chunk, format 1
const MANIFEST_MAGIC = Buffer.from('KBM1');  // Kosmos Backup Manifest, format 1
const ENC_LEN = 32, SIG_LEN = 64;

/* ---------------- content-defined chunking ---------------- */
const CDC = Object.freeze({ min: 256 * 1024, avg: 1024 * 1024, max: 4 * 1024 * 1024 });
// The gear table is fixed forever by format 1: change it and every chunk boundary moves (no dedup across it).
const GEAR = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) t[i] = crypto.createHash('sha256').update('kosmos-backup-gear-v1:' + i).digest().readUInt32BE(0);
  return t;
})();
// The mask tests the HIGH bits: in a gear hash (h << 1) + GEAR[b], bit k depends only on the last k+1 bytes,
// so low-bit masks would cut on a few bytes of local content; high bits carry the whole 32-byte window.
function maskBits(n) { return ((2 ** n - 1) * 2 ** (32 - n)) >>> 0; }
// Normalized chunking: a harder mask before the average size, an easier one after, which narrows the size spread.
const masksFor = (avg) => { const b = Math.round(Math.log2(avg)); return { hard: maskBits(b + 2), easy: maskBits(b - 2) }; };

/** Split a Buffer into content-defined chunks (subarrays, no copy). Deterministic for format 1. */
function chunkBuffer(buf, opts = CDC) {
  const { min, avg, max } = opts;
  if (!(min > 0 && min < avg && avg < max)) throw new Error('backupformat: chunk sizes need 0 < min < avg < max');
  const { hard: MASK_HARD, easy: MASK_EASY } = masksFor(avg);
  const out = [];
  let start = 0;
  while (start < buf.length) {
    const end = Math.min(buf.length, start + max);
    if (end - start <= min) { out.push(buf.subarray(start, end)); break; }
    let h = 0, cut = end;
    for (let i = start + min; i < end; i++) {
      h = ((h << 1) + GEAR[buf[i]]) >>> 0;
      if ((h & (i - start < avg ? MASK_HARD : MASK_EASY)) === 0) { cut = i + 1; break; }
    }
    out.push(buf.subarray(start, cut));
    start = cut;
  }
  return out;
}

/* ---------------- naming and padding ---------------- */
/** The chunk's name inside manifests and associated data: hex HMAC-SHA256 under the period's naming key. */
function chunkName(namingKey, plaintext) {
  if (!Buffer.isBuffer(namingKey) || namingKey.length !== 32) throw new Error('backupformat: the naming key must be 32 bytes');
  return crypto.createHmac('sha256', namingKey).update(plaintext).digest('hex');
}
/** Padme (Nikitin et al., PURBs, 2019): pad L so only O(log log L) bits of it show; overhead at most about 12%. */
function padme(L) {
  if (L < 2) return L;
  const E = Math.floor(Math.log2(L)), S = Math.floor(Math.log2(E)) + 1;
  const lastBits = E - S, mask = 2 ** lastBits - 1;
  return Math.ceil(L / (mask + 1)) * (mask + 1);
}
function frame(plaintext) {
  const total = padme(4 + plaintext.length);
  const f = Buffer.alloc(total);
  f.writeUInt32BE(plaintext.length, 0);
  plaintext.copy(f, 4);
  return f;
}
function unframe(f) {
  if (f.length < 4) return null;
  const n = f.readUInt32BE(0);
  if (n > f.length - 4) return null;
  for (let i = 4 + n; i < f.length; i++) if (f[i] !== 0) return null;  // padding must be zeros
  return f.subarray(4, 4 + n);
}

/* ---------------- chunk objects ---------------- */
const chunkInfo = () => Buffer.from(`kosmos-backup v${FORMAT} chunk`);
/** Seal one chunk to the member's backup public key. Returns the object bytes to upload. */
function sealChunk(memberPk, name, plaintext) {
  if (typeof name !== 'string' || !/^[0-9a-f]{64}$/.test(name)) throw new Error('backupformat: a chunk name is 64 hex characters');
  const { enc, ct } = hpkeSeal(memberPk, chunkInfo(), Buffer.from(name), frame(plaintext));
  return Buffer.concat([CHUNK_MAGIC, enc, ct]);
}
/** Open one chunk object. Returns the plaintext, or null on ANY failure (wrong key, wrong name, tampering). */
function openChunk(memberSk, name, object) {
  try {
    if (!Buffer.isBuffer(object) || object.length < CHUNK_MAGIC.length + ENC_LEN + 16 || typeof name !== 'string') return null;
    if (!object.subarray(0, 4).equals(CHUNK_MAGIC)) return null;
    const enc = object.subarray(4, 4 + ENC_LEN), ct = object.subarray(4 + ENC_LEN);
    const f = hpkeOpen(memberSk, enc, chunkInfo(), Buffer.from(name), ct);
    return f ? unframe(f) : null;
  } catch { return null; }
}
/** True only when plaintext really is the content its name claims (restore checks every chunk). */
function chunkMatchesName(namingKey, name, plaintext) {
  try {
    const want = Buffer.from(chunkName(namingKey, plaintext), 'hex'), got = Buffer.from(String(name), 'hex');
    return got.length === 32 && crypto.timingSafeEqual(want, got);
  } catch { return false; }
}

/* ---------------- manifests ---------------- */
/** Canonical JSON: object keys sorted at every depth, no whitespace. Arrays keep their order. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('backupformat: a manifest cannot hold NaN or Infinity');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
const CTX_FIELDS = ['org', 'member', 'epoch', 'period', 'snapshot'];
/** The snapshot context every manifest is bound to (associated data AND signed). All five fields required. */
function contextBytes(ctx) {
  for (const k of CTX_FIELDS) {
    if (!ctx || typeof ctx[k] !== 'string' || !ctx[k] || ctx[k].includes('\n')) throw new Error(`backupformat: the context needs a non-empty ${k}`);
  }
  return Buffer.from(`kosmos-backup v${FORMAT} manifest\n` + CTX_FIELDS.map((k) => `${k}=${ctx[k]}`).join('\n'));
}
function signedBytes(sealed, ctx) {
  return Buffer.concat([crypto.createHash('sha256').update(sealed).digest(), contextBytes(ctx)]);
}
/**
 * Seal and sign a manifest. deviceKey is the member device's Ed25519 private KeyObject.
 * Returns the object bytes: MAGIC | signature(64) | enc(32) | ct. The signature covers sha256(MAGIC|enc|ct) and the context.
 */
function sealManifest(memberPk, deviceKey, ctx, manifest) {
  const cb = contextBytes(ctx);
  const { enc, ct } = hpkeSeal(memberPk, Buffer.from(`kosmos-backup v${FORMAT} manifest`), cb, Buffer.from(canonicalJson(manifest)));
  const sealed = Buffer.concat([MANIFEST_MAGIC, enc, ct]);
  const sig = crypto.sign(null, signedBytes(sealed, ctx), deviceKey);
  return Buffer.concat([MANIFEST_MAGIC, sig, enc, ct]);
}
/** Check a manifest's signature WITHOUT decrypting (the coordinator's check). Returns true or false, never throws. */
function verifyManifestSignature(devicePub, ctx, object) {
  try {
    if (!Buffer.isBuffer(object) || object.length < 4 + SIG_LEN + ENC_LEN + 16 || !object.subarray(0, 4).equals(MANIFEST_MAGIC)) return false;
    const sig = object.subarray(4, 4 + SIG_LEN);
    const sealed = Buffer.concat([MANIFEST_MAGIC, object.subarray(4 + SIG_LEN)]);
    return crypto.verify(null, signedBytes(sealed, ctx), devicePub, sig);
  } catch { return false; }
}
/** Verify the device signature, then open the manifest. Returns the parsed manifest, or null on ANY failure. */
function openManifest(memberSk, devicePub, ctx, object) {
  try {
    if (!verifyManifestSignature(devicePub, ctx, object)) return null;
    const enc = object.subarray(4 + SIG_LEN, 4 + SIG_LEN + ENC_LEN), ct = object.subarray(4 + SIG_LEN + ENC_LEN);
    const pt = hpkeOpen(memberSk, enc, Buffer.from(`kosmos-backup v${FORMAT} manifest`), contextBytes(ctx), ct);
    return pt ? JSON.parse(pt.toString('utf8')) : null;
  } catch { return null; }
}

module.exports = {
  CDC,
  chunkBuffer,
  chunkName,
  padme,
  sealChunk,
  openChunk,
  chunkMatchesName,
  canonicalJson,
  sealManifest,
  verifyManifestSignature,
  openManifest,
};
