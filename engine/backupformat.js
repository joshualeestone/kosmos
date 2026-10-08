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
 *    associated data. That stops objects being SWAPPED between names; it does NOT prove who wrote a chunk:
 *    HPKE base mode has no sender authentication, so anyone with the public key can seal any content under
 *    any name. INTEGRITY comes from the name itself (an HMAC under the period naming key, which only the
 *    member's side holds), so restore opens chunks ONLY through openVerifiedChunk, which checks both.
 *    The plaintext inside is length-framed and padded to a Padme bucket, never below 4 KiB, so an object's
 *    size hides the exact size of what it holds (small files, the common case, all look 4 KiB).
 *  - MANIFEST = canonical JSON, framed and padded like a chunk, HPKE-sealed (associated data: the snapshot
 *    context), and SIGNED by the member device's Ed25519 key over a domain tag, the sealed bytes' hash and the
 *    context. The coordinator can check the signature and record the hash at grant time without decrypting.
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

function checkSizes({ min, avg, max }) {
  if (![min, avg, max].every(Number.isSafeInteger) || !(min > 0 && min < avg && avg < max) || avg < 64 || avg > 2 ** 28) {
    throw new Error('backupformat: chunk sizes need integers with 0 < min < avg < max and 64 <= avg <= 2^28');
  }
  return masksFor(avg);
}
/* The one cut search, shared by chunkBuffer and the streaming chunker so they can never disagree: from start, the
   cut depends only on the bytes in [start, end), where end = start + max unless the data ends first. */
function cutAt(buf, start, end, { min, avg }, { hard, easy }) {
  if (end - start <= min) return end;
  let h = 0;
  for (let i = start + min; i < end; i++) {
    h = ((h << 1) + GEAR[buf[i]]) >>> 0;
    if ((h & (i - start < avg ? hard : easy)) === 0) return i + 1;
  }
  return end;
}

/** Split a Buffer into content-defined chunks (subarrays, no copy). Deterministic for format 1. */
function chunkBuffer(buf, opts = CDC) {
  const masks = checkSizes(opts);
  const out = [];
  for (let start = 0; start < buf.length;) {
    const cut = cutAt(buf, start, Math.min(buf.length, start + opts.max), opts, masks);
    out.push(buf.subarray(start, cut));
    start = cut;
  }
  return out;
}

/**
 * The same chunking over a stream: push(piece) returns the chunks completed so far (copies), finish() the rest.
 * Holds just under max bytes plus the pieces collected since the last join (itself under max) plus the latest piece,
 * so a file larger than memory can be backed up.
 * A cut is made only once max bytes past the chunk start are held, which is exactly when chunkBuffer would see
 * the same window: the boundaries are identical to chunkBuffer's on the whole input (tested, golden vector too).
 */
function createChunker(opts = CDC) {
  const masks = checkSizes(opts);
  // Pieces are collected and joined only once at least max bytes are held, so small reads do not copy the
  // pending tail on every push. Each piece is copied in, so a caller may reuse its read buffer.
  let pending = Buffer.alloc(0), parts = [], held = 0, done = false;
  return {
    push(piece) {
      if (done) throw new Error('backupformat: push after finish');
      if (!Buffer.isBuffer(piece)) throw new Error('backupformat: push takes a Buffer');
      parts.push(Buffer.from(piece)); held += piece.length;
      if (pending.length + held < opts.max) return [];
      pending = Buffer.concat([pending, ...parts]); parts = []; held = 0;
      const out = [];
      while (pending.length >= opts.max) {
        const cut = cutAt(pending, 0, opts.max, opts, masks);
        out.push(Buffer.from(pending.subarray(0, cut)));
        pending = pending.subarray(cut);
      }
      return out;
    },
    finish() {
      if (done) throw new Error('backupformat: finish twice');
      done = true;
      return chunkBuffer(Buffer.concat([pending, ...parts]), opts).map((c) => Buffer.from(c));
    },
  };
}

/* ---------------- naming and padding ---------------- */
/** The chunk's name inside manifests and associated data: hex HMAC-SHA256 under the period's naming key. */
function chunkName(namingKey, plaintext) {
  // SECURITY: restore trusts a chunk only because nobody else can compute its name. An empty or short key would
  // let anyone holding the public key forge a valid name for any content.
  if (!Buffer.isBuffer(namingKey) || namingKey.length !== 32) throw new Error('backupformat: the naming key must be 32 bytes');
  return crypto.createHmac('sha256', namingKey).update(plaintext).digest('hex');
}
/** Padme (Nikitin et al., PURBs, 2019): pad L so only O(log log L) bits of it show; overhead at most about 12%. */
// floor(log2(n)) by integer bit math below 2^32, so the exact frame size (which unframe insists on) cannot
// depend on any engine's Math.log2 rounding. Frames here are far below 2^32.
const log2floor = (n) => (n < 2 ** 32 ? 31 - Math.clz32(n) : Math.floor(Math.log2(n)));
function padme(L) {
  if (L < 2) return L;
  const E = log2floor(L), S = log2floor(E) + 1;
  const lastBits = E - S, mask = 2 ** lastBits - 1;
  return Math.ceil(L / (mask + 1)) * (mask + 1);
}
const MIN_FRAME = 4096;
const frameSize = (n) => Math.max(MIN_FRAME, padme(4 + n));
function frame(plaintext) {
  const total = frameSize(plaintext.length);
  const f = Buffer.alloc(total);
  f.writeUInt32BE(plaintext.length, 0);
  plaintext.copy(f, 4);
  return f;
}
function unframe(f) {
  if (f.length < 4) return null;
  const n = f.readUInt32BE(0);
  // exactly one valid encoding per plaintext (the first half is defence in depth: frameSize(n) > n + 4 already)
  if (n > f.length - 4 || f.length !== frameSize(n)) return null;
  for (let i = 4 + n; i < f.length; i++) if (f[i] !== 0) return null;  // padding must be zeros
  return f.subarray(4, 4 + n);
}

/* ---------------- chunk objects ---------------- */
const chunkInfo = () => Buffer.from(`kosmos-backup v${FORMAT} chunk`);
const NAME_RE = /^[0-9a-f]{64}$/;
/* Seal one chunk under a GIVEN name: internal. A well-formed but wrong name would upload fine and never restore,
   so the uploader seals only through sealNamedChunk, which derives the name itself. */
function sealChunk(memberPk, name, plaintext) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('backupformat: a chunk name is 64 lowercase hex characters');
  const { enc, ct } = hpkeSeal(memberPk, chunkInfo(), Buffer.from(name), frame(plaintext));
  return Buffer.concat([CHUNK_MAGIC, enc, ct]);
}
/** The uploader's entry: derive the chunk's name from its content, seal it. Returns { name, object }. */
function sealNamedChunk(memberPk, namingKey, plaintext) {
  const name = chunkName(namingKey, plaintext);
  return { name, object: sealChunk(memberPk, name, plaintext) };
}
/* Open one chunk object WITHOUT checking its content against its name: internal only. A forged chunk (sealed
   by anyone holding the public key, under a real name) opens here; openVerifiedChunk is the restore entry. */
function openChunk(memberSk, name, object) {
  try {
    if (!Buffer.isBuffer(object) || object.length < CHUNK_MAGIC.length + ENC_LEN + 16 || typeof name !== 'string' || !NAME_RE.test(name)) return null;
    if (!object.subarray(0, 4).equals(CHUNK_MAGIC)) return null;
    const enc = object.subarray(4, 4 + ENC_LEN), ct = object.subarray(4 + ENC_LEN);
    const f = hpkeOpen(memberSk, enc, chunkInfo(), Buffer.from(name), ct);
    return f ? unframe(f) : null;
  } catch { return null; }
}
/* True only when plaintext really is the content its (canonical) name claims. */
function chunkMatchesName(namingKey, name, plaintext) {
  try {
    if (typeof name !== 'string' || !NAME_RE.test(name)) return false;
    return crypto.timingSafeEqual(Buffer.from(chunkName(namingKey, plaintext), 'hex'), Buffer.from(name, 'hex'));
  } catch { return false; }
}
/** The ONLY way restore opens a chunk: decrypt, then prove the content is what its name says. Null on ANY failure. */
function openVerifiedChunk(memberSk, namingKey, name, object) {
  const pt = openChunk(memberSk, name, object);
  return pt && chunkMatchesName(namingKey, name, pt) ? pt : null;
}

/* ---------------- manifests ---------------- */
/* Canonical JSON: object keys sorted at every depth (UTF-16 order), no whitespace, arrays in order. The signature
   covers the ciphertext, so canonical form is for determinism, not for the signature. STRICT: anything JSON
   would drop, mangle or fail to read back (undefined, functions, symbols, bigint, NaN, Infinity, -0, unsafe
   integers, Dates, Maps, class instances) is refused, because a manifest that seals but cannot be parsed is a
   snapshot that verifies and can never be restored. */
function canonicalJson(v) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Object.is(v, -0)) throw new Error('backupformat: a manifest cannot hold NaN, Infinity or -0');
    if (Number.isInteger(v) && !Number.isSafeInteger(v)) throw new Error('backupformat: a manifest integer must be a safe integer');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) {
    // No holes and nothing but the indices: [,] would otherwise serialize to [] and still read back.
    const own = Reflect.ownKeys(v).filter((k) => k !== 'length');
    if (own.length !== v.length || own.some((k, i) => k !== String(i))) throw new Error('backupformat: a manifest array cannot have holes or extra properties');
    return '[' + v.map(canonicalJson).join(',') + ']';
  }
  if (typeof v === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error('backupformat: a manifest holds plain objects only');
    const keys = Object.keys(v);
    // Symbol keys and non-enumerable properties would be dropped without a word: refuse them.
    if (Reflect.ownKeys(v).length !== keys.length) throw new Error('backupformat: a manifest object cannot have symbol keys or hidden properties');
    // An own "__proto__" key is data and round-trips as an own property; restore must not merge a manifest into
    // another object with Object.assign or spread without knowing that.
    return '{' + keys.sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  }
  throw new Error(`backupformat: a manifest cannot hold a ${typeof v}`);
}
const CTX_FIELDS = ['org', 'member', 'epoch', 'period', 'snapshot'];
const CTX_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
/** The snapshot context every manifest is bound to (associated data AND signed). All five fields required. */
function contextBytes(ctx) {
  for (const k of CTX_FIELDS) {
    // Ids are pinned to a plain alphabet: a lone surrogate would become U+FFFD in the bytes, so two different
    // contexts could share one signed byte string; a newline could forge a field.
    if (!ctx || typeof ctx[k] !== 'string' || !CTX_ID_RE.test(ctx[k])) throw new Error(`backupformat: the context needs a non-empty ${k} of letters, digits and . _ : -`);
  }
  return Buffer.from(`kosmos-backup v${FORMAT} manifest\n` + CTX_FIELDS.map((k) => `${k}=${ctx[k]}`).join('\n'));
}
// A fixed tag FIRST, so a device signature over a backup manifest can never double as a signature in any other
// protocol the same device key signs for (device auth, after E0.1).
const SIG_DOMAIN = Buffer.from(`kosmos-backup v${FORMAT} manifest-signature\0`);
/** Throws when ctx is not a valid manifest context (the same rule sealing and opening apply). */
function checkBackupContext(ctx) { contextBytes(ctx); }
function signedBytes(sealed, ctx) {
  return Buffer.concat([SIG_DOMAIN, crypto.createHash('sha256').update(sealed).digest(), contextBytes(ctx)]);
}
/**
 * Seal and sign a manifest. deviceKey is the member device's Ed25519 private KeyObject.
 * Returns the object bytes: MAGIC | signature(64) | enc(32) | ct. The signature covers sha256(MAGIC|enc|ct) and the context.
 */
function sealManifest(memberPk, deviceKey, ctx, manifest) {
  // Ed25519 only: crypto.sign accepts any key type, but the layout holds a 64-byte signature, so another key type
  // would seal a manifest that can never verify or open (review round 3 measured P-256, Ed448 and RSA).
  if (!deviceKey || deviceKey.type !== 'private' || deviceKey.asymmetricKeyType !== 'ed25519') throw new Error('backupformat: the device key must be an Ed25519 private key');
  const cb = contextBytes(ctx);
  // A plain object only: a top-level null would open as null, which is also what every failure returns.
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('backupformat: a manifest is a plain object');
  const json = canonicalJson(manifest);
  // Defence in depth: the strict canonicalJson rules leave no known value that passes them and fails to read back.
  if (canonicalJson(JSON.parse(json)) !== json) throw new Error('backupformat: the manifest does not read back as itself');
  const { enc, ct } = hpkeSeal(memberPk, Buffer.from(`kosmos-backup v${FORMAT} manifest`), cb, frame(Buffer.from(json)));
  const sealed = Buffer.concat([MANIFEST_MAGIC, enc, ct]);
  const sig = crypto.sign(null, signedBytes(sealed, ctx), deviceKey);
  if (sig.length !== SIG_LEN) throw new Error('backupformat: the manifest signature is not 64 bytes');  // defence in depth after the Ed25519 check
  return Buffer.concat([MANIFEST_MAGIC, sig, enc, ct]);
}
/** Check a manifest's signature WITHOUT decrypting (the coordinator's check). Returns true or false, never throws.
 *  devicePub MUST come from trusted state (the member's enrolled devices, E0.2), never from the object or
 *  the uploader: the signature proves "this device signed it", and only that binding makes it "this member". */
function verifyManifestSignature(devicePub, ctx, object) {
  try {
    // A PUBLIC Ed25519 key only. (An Ed25519 signature never verifies under another key type anyway, so the
    // type half is defence in depth; the public half is what a caller can actually get wrong.)
    if (!devicePub || devicePub.type !== 'public' || devicePub.asymmetricKeyType !== 'ed25519') return false;
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
    const f = hpkeOpen(memberSk, enc, Buffer.from(`kosmos-backup v${FORMAT} manifest`), contextBytes(ctx), ct);
    const pt = f ? unframe(f) : null;
    const m = pt ? JSON.parse(pt.toString('utf8')) : null;
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;  // what sealManifest accepts, and nothing else
  } catch { return null; }
}

module.exports = {
  CDC,
  chunkBuffer,
  createChunker,
  chunkName,
  padme,
  sealNamedChunk,
  openVerifiedChunk,
  canonicalJson,
  sealManifest,
  verifyManifestSignature,
  openManifest,
  checkBackupContext,
};
