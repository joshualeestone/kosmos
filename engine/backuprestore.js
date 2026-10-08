/**
 * kosmos#5536 (E0.7, restore) step 3, its pure part: turn one backed-up snapshot back into files.
 * Design v2.1 on #5536 and E0.6's on #5535. No I/O of its own: the caller supplies the manifest object, a way to
 * fetch each chunk object by its name, a sink that writes files, and the keys a release handed it. Built on
 * engine/backupformat.js.
 *
 *  - The manifest is opened only with the device public key that was enrolled for that member AT THE SNAPSHOT'S
 *    TIME (the caller looks it up in E0.2's device history).
 *  - Every chunk goes through openVerifiedChunk, and every file is checked against the size and sha256 the
 *    manifest recorded at upload.
 *  - Paths are refused unless they are plain relative paths (see pathProblem), and colliding entries (see
 *    collisionKey) are all refused, not first-wins.
 *  - Files stream through the sink one chunk at a time; a file is committed only after all of it verified, and
 *    aborted otherwise.
 */
const crypto = require('crypto');
const { CDC, openManifest, openVerifiedChunk, checkBackupContext } = require('./backupformat');

const CHUNK_NAME_RE = /^[0-9a-f]{64}$/;
// The format-1 uploader chunks with CDC, so a chunk holds at most CDC.max bytes; sealed and padded it stays well
// under twice that. A bigger object is refused before it is decrypted (raise maxChunkObject for other chunk sizes).
const MAX_CHUNK_OBJECT = 2 * CDC.max + 4096;
const MAX_SKIPPED_REPORTED = 10000;
const MAX_FAILED_REPORTED = 10000;
const WORK_PER_ENTRY = 8192;
// Bounds on the manifest: its object is refused before it is decrypted, its entry count before it is walked. A
// manifest is parsed whole, so these stay modest (about 270 bytes an entry); the caller can raise both.
const MAX_MANIFEST_OBJECT = 128 * 1024 * 1024;
const MAX_FILES = 500_000;
const SHA256_RE = /^[0-9a-f]{64}$/;
// Windows device names, with or without an extension, and with spaces before it (CON, nul.txt, COM1.log, nul .txt).
const WIN_RESERVED_RE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i;
// The shape of an NTFS 8.3 short name (PROGRA~1, LONGFI~1.MD), which can name another entry's file.
const SHORT_NAME_RE = /^[^.]{1,6}~[0-9]+(\.[^.]{1,3})?$/;
const IGNORABLE_RE = /\p{Default_Ignorable_Code_Point}/gu;
const UNSAFE = 'malformed entry or unsafe path';
const NOT_PORTABLE = 'a name not every system accepts';
// Segment rules, checked as written and with invisible characters dropped.
const segmentUnsafe = (x) => x === '' || x === '.' || x === '..';
// Names Windows refuses, or trims to another file's name: a trailing dot or space, device names, short names.
const segmentNotPortable = (x) => /[. ]$/.test(x) || WIN_RESERVED_RE.test(x) || SHORT_NAME_RE.test(x);

/* Why a manifest path cannot be restored, or null. UNSAFE: it could escape, alias or disguise another name.
   NOT_PORTABLE: a name some systems cannot hold. The same rules apply on every destination, so a Mac restore also
   refuses legal Mac names such as Icon\r (custom folder icons), aux.c or a name with ':'; each is reported. */
function pathProblem(p) {
  if (typeof p !== 'string' || !p || p.length > 4096 || !p.isWellFormed()) return UNSAFE;  // a lone surrogate encodes as U+FFFD
  if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(p)) return UNSAFE;  // bidi controls and marks reorder how a name displays
  const segs = p.split(/[\\/]/).flatMap((x) => [x, x.replace(IGNORABLE_RE, '')]);
  if (segs.some(segmentUnsafe)) return UNSAFE;
  // Control characters (C0, DEL, C1, line and paragraph separators) and ':' (a drive or an NTFS stream).
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029:]/.test(p) || segs.some(segmentNotPortable)) return NOT_PORTABLE;
  return null;
}

/* The key two entries collide on: invisible characters dropped, NFC, lower-, upper- then lower-cased (so final sigma
   folds with sigma, and capital sharp s with ss), NFC again, with '\' read as '/'. An approximation of APFS and NTFS name matching, not their exact
   folding; where it differs it mostly over-refuses (straße and strasse collide here, not on APFS); see the sink
   duties. */
const collisionKey = (p) => toSinkPath(p).replace(IGNORABLE_RE, '')
  .normalize('NFC').toLowerCase().toUpperCase().toLowerCase().normalize('NFC');
/* pathProblem and collisionKey read '\' as a separator, so the sink is handed the same reading. */
const toSinkPath = (p) => p.replace(/\\/g, '/');
/* A manifest path as reported back: bounded, since a refused entry's path is not length-checked. */
const forReport = (p) => (p.length > 300 ? `${p.slice(0, 300).replace(/[\ud800-\udbff]$/, '')}...` : p);

/** Every manifest path that must not be restored because another entry collides with it (see collisionKey): the
 *  same key, or a key that is another's folder. A trie of key segments, so the cost is linear in the paths' length. */
function collidingPaths(entries) {
  const node = () => ({ kids: new Map(), files: [], below: 0 });
  const root = node();
  for (const f of entries) {
    let n = root;
    for (const seg of collisionKey(f.path).split('/')) {
      if (!n.kids.has(seg)) n.kids.set(seg, node());
      n = n.kids.get(seg);
    }
    n.files.push(f.path);
  }
  const countBelow = (n) => { for (const k of n.kids.values()) n.below += countBelow(k); return n.below + n.files.length; };
  countBelow(root);
  const bad = new Set();
  const mark = (n, fileAbove) => {
    if (n.files.length && (n.files.length > 1 || n.below > 0 || fileAbove)) n.files.forEach((p) => bad.add(p));
    for (const k of n.kids.values()) mark(k, fileAbove || n.files.length > 0);
  };
  mark(root, false);
  return bad;
}

/**
 * Restore one snapshot. Resolves to { restored: [path], failed: [{ path, why }] (the first 10000), failedNotListed
 * (how many more failed), skippedAtBackup: [...] }; or { overBound: 'maxManifestObject' | 'maxFiles' } when the
 * manifest is larger than the caller allowed (raise the bound and retry; the object-size bound is checked before the
 * signature, so it says nothing about authenticity); or null
 * when the manifest itself does not verify and open (wrong device key for the time, wrong context, tampering). maxTotalBytes is REQUIRED (the caller sets it from free disk) and caps the
 * bytes committed: a file that would pass it fails before anything is fetched. Every fetched object's bytes count
 * against twice that, plus 8 KiB for each entry that is tried (sealing overhead), whether or not it verifies; and
 * one object may be at most twice its file's recorded size plus 8 KiB. So a hostile store or files that fail late
 * cost at most 2 x maxTotalBytes + 8 KiB x maxFiles (about 4 GB at the default maxFiles) of download, with a fetch that
 * honours maxBytes (one that does not can overdraw by one object).
 *
 *   fetchChunk(name, { maxBytes }) -> Buffer, Uint8Array or ArrayBuffer | null, or a promise of one (null: the chunk is not
 *     stored). It should refuse to download more than maxBytes; restore refuses a larger object before decrypting it.
 *   sink.begin(path) -> { write(buf), commit(), abort() } (each may return a promise). Bytes are written BEFORE the
 *     file is verified, so the sink must write somewhere other than the final path, leave any existing file there
 *     untouched until commit, and publish atomically on commit. abort must be safe at any point, including after
 *     a commit that threw. The sink is handed paths with '/' separators (so a Mac name holding '\' comes back as a
 *     folder), and must also:
 *       - refuse to overwrite a file it already committed in this restore, comparing file identity (inode or file
 *         ID), not path strings (collision refusal here is approximate);
 *       - refuse a path whose folders resolve outside the restore root, such as through a symlink already there;
 *       - use the operating system's Unicode file APIs (on Windows, never an ANSI or best-fit conversion, which
 *         turns a fullwidth '．．' into '..').
 *     Paths may name dotfiles (.ssh, .zshrc, .git/hooks): restore into a root the person chose, not over live config.
 *
 * Paths in failed and skippedAtBackup come from the manifest and may hold any printable text: escape them for
 * display.
 */
async function restoreSnapshot({ memberSk, namingKey, devicePubAtSnapshot, ctx, manifestObject, fetchChunk, sink,
  maxChunkObject = MAX_CHUNK_OBJECT, maxManifestObject = MAX_MANIFEST_OBJECT, maxFiles = MAX_FILES, maxTotalBytes }) {
  // Caller mistakes throw rather than read as tampering in every file.
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 0) throw new Error('backuprestore: maxTotalBytes (a byte budget, from free disk) is required');
  if (!sink || typeof sink.begin !== 'function') throw new Error('backuprestore: sink.begin is required');
  if (typeof fetchChunk !== 'function') throw new Error('backuprestore: fetchChunk is required');
  if (!Buffer.isBuffer(namingKey) || namingKey.length !== 32) throw new Error('backuprestore: namingKey must be a 32-byte Buffer');
  checkBackupContext(ctx);
  if (!(devicePubAtSnapshot instanceof crypto.KeyObject) || devicePubAtSnapshot.type !== 'public' || devicePubAtSnapshot.asymmetricKeyType !== 'ed25519') {
    throw new Error('backuprestore: devicePubAtSnapshot must be an Ed25519 public key');
  }
  if (!(manifestObject instanceof Uint8Array) && !(manifestObject instanceof ArrayBuffer)) throw new Error('backuprestore: manifestObject must be bytes');
  for (const [k, v] of Object.entries({ maxChunkObject, maxManifestObject, maxFiles })) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`backuprestore: ${k} must be a non-negative integer`);
  }
  const mo = toBuffer(manifestObject);
  if (mo.length > maxManifestObject) return { overBound: 'maxManifestObject' };
  const manifest = openManifest(memberSk, devicePubAtSnapshot, ctx, mo);
  if (!manifest || !Array.isArray(manifest.files)) return null;
  if (manifest.files.length > maxFiles) return { overBound: 'maxFiles' };
  const restored = [], failed = [];
  const wellFormed = [];
  for (const f of manifest.files) {
    const shown = f && typeof f.path === 'string' ? forReport(f.path) : '(unnamed)';
    const problem = f ? pathProblem(f.path) : UNSAFE;
    // Every chunk holds at least one byte, so a file has no more chunks than bytes.
    if (problem === UNSAFE || !Array.isArray(f.chunks) || typeof f.sha256 !== 'string' || !SHA256_RE.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size < 0
      || f.chunks.length > f.size) failed.push({ path: shown, why: UNSAFE });
    else if (problem) failed.push({ path: shown, why: problem });
    else if (!f.chunks.every((n) => typeof n === 'string' && CHUNK_NAME_RE.test(n))) failed.push({ path: shown, why: 'a chunk name is malformed' });
    else wellFormed.push(f);
  }
  const clash = collidingPaths(wellFormed);
  // Two budgets: bytes committed (maxTotalBytes), and bytes FETCHED whether or not they verify or their file commits
  // (twice that, plus room for each entry's sealing overhead: a small chunk is padded to a 4 KiB frame).
  let budget = maxTotalBytes;
  const work = { left: 2 * maxTotalBytes + WORK_PER_ENTRY * wellFormed.filter((f) => !clash.has(f.path)).length };
  for (const f of wellFormed) {
    if (clash.has(f.path)) { failed.push({ path: forReport(f.path), why: 'another entry lands on the same file or folder' }); continue; }
    if (f.size > budget || f.size > work.left) { failed.push({ path: forReport(f.path), why: 'the restore is over its byte budget' }); continue; }
    const why = await restoreFile(f, { memberSk, namingKey, fetchChunk, sink, maxChunkObject, work });
    if (why) failed.push({ path: forReport(f.path), why });
    else { restored.push(f.path); budget -= f.size; }
  }
  const skippedAtBackup = (Array.isArray(manifest.skipped) ? manifest.skipped : [])
    .filter((x) => x && typeof x.path === 'string' && typeof x.why === 'string').slice(0, MAX_SKIPPED_REPORTED)
    .map(({ path, why }) => ({ path: forReport(path), why: forReport(why) }));
  return { restored, failed: failed.slice(0, MAX_FAILED_REPORTED), failedNotListed: Math.max(0, failed.length - MAX_FAILED_REPORTED), skippedAtBackup };
}

/* One file: null when committed, otherwise why it was not. Never leaves a file committed that did not verify. */
async function restoreFile(f, { memberSk, namingKey, fetchChunk, sink, maxChunkObject, work }) {
  let out = null;
  try {
    out = await sink.begin(toSinkPath(f.path));
    const hash = crypto.createHash('sha256');
    let size = 0;
    for (const name of f.chunks) {
      let obj;
      try { obj = await fetchChunk(name, { maxBytes: Math.min(maxChunkObject, 2 * f.size + WORK_PER_ENTRY, work.left) }); } catch { return await abortWith(out, 'a chunk could not be fetched'); }
      if (obj == null) return await abortWith(out, 'a chunk is missing');
      if (!(obj instanceof Uint8Array) && !(obj instanceof ArrayBuffer)) return await abortWith(out, 'the fetch returned something that is not bytes');
      obj = toBuffer(obj);
      // Charged first: these bytes were downloaded whether or not they are kept.
      if (obj.length > work.left) { work.left = 0; return await abortWith(out, 'the restore is over its byte budget'); }
      work.left -= obj.length;
      // A chunk of this file holds at most f.size bytes, and sealing adds at most a 4 KiB frame plus padding.
      if (obj.length > maxChunkObject || obj.length > 2 * f.size + WORK_PER_ENTRY) return await abortWith(out, 'a chunk is larger than any real chunk');
      const pt = openVerifiedChunk(memberSk, namingKey, name, obj);
      if (!pt || !pt.length) return await abortWith(out, 'a chunk did not verify (forged, swapped or damaged)');
      size += pt.length;
      if (size > f.size) return await abortWith(out, 'the file does not match the size recorded at upload');
      hash.update(pt);
      await out.write(pt);
    }
    if (size !== f.size) return await abortWith(out, 'the file does not match the size recorded at upload');
    if (hash.digest('hex') !== f.sha256) return await abortWith(out, 'the file does not match the hash recorded at upload');
    await out.commit();
    return null;
  } catch {
    return await abortWith(out, 'the file could not be written');
  }
}

/* A Buffer view of bytes handed over as a Buffer, another Uint8Array or an ArrayBuffer (no copy). */
const toBuffer = (b) => (Buffer.isBuffer(b) ? b : b instanceof ArrayBuffer ? Buffer.from(b) : Buffer.from(b.buffer, b.byteOffset, b.length));

async function abortWith(out, why) {
  try { if (out) await out.abort(); } catch { /* the reason already names the failure */ }
  return why;
}

/** A warning when the newer snapshot holds far less than the older one. Null otherwise. Counts and sizes are
 *  read from the manifests, which the backing-up device writes: a heuristic for an accidental or careless
 *  shrink, not a defence against a device that pads its manifest. */
function shrinkWarning(older, newer, { files = 0.5, bytes = 0.5 } = {}) {
  const count = (m) => (Array.isArray(m && m.files) ? m.files.length : 0);
  const size = (m) => (Array.isArray(m && m.files) ? m.files.reduce((n, f) => n + (Number.isSafeInteger(f && f.size) && f.size > 0 ? f.size : 0), 0) : 0);
  const fo = count(older), fn = count(newer), bo = size(older), bn = size(newer);
  const reasons = [];
  if (fo > 0 && fn < fo * files) reasons.push(`files fell from ${fo} to ${fn}`);
  if (bo > 0 && bn < bo * bytes) reasons.push(`size fell from ${bo} to ${bn} bytes`);
  return reasons.length ? reasons.join('; ') : null;
}

module.exports = {
  restoreSnapshot,
  shrinkWarning,
};
