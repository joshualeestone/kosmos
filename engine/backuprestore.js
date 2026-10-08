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
 *  - Paths are refused unless they are plain relative paths (see safeRel), and colliding entries (see
 *    collisionKey) are all refused, not first-wins.
 *  - Files stream through the sink one chunk at a time; a file is committed only after all of it verified, and
 *    aborted otherwise.
 */
const crypto = require('crypto');
const { CDC, openManifest, openVerifiedChunk } = require('./backupformat');

const CHUNK_NAME_RE = /^[0-9a-f]{64}$/;
// A format-1 chunk holds at most CDC.max bytes; sealed and padded it stays well under twice that. A bigger object
// is refused before it is decrypted.
const MAX_CHUNK_OBJECT = 2 * CDC.max + 4096;
// Windows device names, with or without an extension (CON, nul.txt, COM1.log).
const WIN_RESERVED_RE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 4096 || !p.isWellFormed()) return false;  // a lone surrogate encodes as U+FFFD
  if (/\p{Default_Ignorable_Code_Point}/u.test(p)) return false;  // invisible characters APFS may ignore in a name
  if (/[\x00-\x1f\x7f:]/.test(p)) return false;  // control characters; ':' is a drive or an NTFS stream
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  // A segment may not be empty or end in a dot or a space: that refuses '.' and '..' too, and the names Windows
  // silently trims to another file's name.
  return p.split(/[\\/]/).every((x) => x !== '' && !/[. ]$/.test(x) && !WIN_RESERVED_RE.test(x));
}

/* The key two entries collide on: NFC, upper- then lower-cased (so final sigma folds with sigma), NFC again, with
   '\' read as '/'. An approximation of APFS and NTFS name matching, not their exact folding; see the sink duties. */
const collisionKey = (p) => toSinkPath(p).normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
/* safeRel and collisionKey read '\' as a separator, so the sink is handed the same reading. */
const toSinkPath = (p) => p.replace(/\\/g, '/');
/* A manifest path as reported back: bounded, since a refused entry's path is not length-checked. */
const forReport = (p) => (p.length > 300 ? `${p.slice(0, 300)}...` : p);

/** Every manifest path that must not be restored because another entry collides with it (see collisionKey). */
function collidingPaths(entries) {
  const byKey = new Map();
  for (const f of entries) {
    const k = collisionKey(f.path);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(f.path);
  }
  const bad = new Set();
  for (const paths of byKey.values()) if (paths.length > 1) paths.forEach((p) => bad.add(p));
  for (const [k, paths] of byKey) {
    const parts = k.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = byKey.get(parts.slice(0, i).join('/'));
      if (parent) { parent.forEach((p) => bad.add(p)); paths.forEach((p) => bad.add(p)); }
    }
  }
  return bad;
}

/**
 * Restore one snapshot. Resolves to { restored: [path], failed: [{ path, why }], skippedAtBackup: [...] }, or null
 * when the manifest itself does not verify and open (wrong device key for the time, wrong context, tampering).
 *
 *   fetchChunk(name) -> Buffer or Uint8Array | null, or a promise of one (null: the chunk is not stored). It should
 *     refuse to download an object larger than maxChunkObject; restore refuses one before decrypting it.
 *   sink.begin(path) -> { write(buf), commit(), abort() } (each may return a promise). Bytes are written BEFORE the
 *     file is verified, so the sink must write somewhere other than the final path, leave any existing file there
 *     untouched until commit, and publish atomically on commit. abort must be safe at any point, including after
 *     a commit that threw. The sink is handed paths with '/' separators, and must also:
 *       - refuse to overwrite a file it already committed in this restore (collision refusal here is approximate);
 *       - refuse a path whose folders resolve outside the restore root, such as through a symlink already there.
 *
 * Paths in failed and skippedAtBackup come from the manifest and may hold any printable text: escape them for
 * display.
 */
async function restoreSnapshot({ memberSk, namingKey, devicePubAtSnapshot, ctx, manifestObject, fetchChunk, sink, maxChunkObject = MAX_CHUNK_OBJECT }) {
  const manifest = openManifest(memberSk, devicePubAtSnapshot, ctx, manifestObject);
  if (!manifest || !Array.isArray(manifest.files)) return null;
  const restored = [], failed = [];
  const wellFormed = [];
  for (const f of manifest.files) {
    if (!f || !safeRel(f.path) || !Array.isArray(f.chunks) || typeof f.sha256 !== 'string' || !Number.isSafeInteger(f.size) || f.size < 0) {
      failed.push({ path: f && typeof f.path === 'string' ? forReport(f.path) : '(unnamed)', why: 'malformed entry or unsafe path' });
    } else wellFormed.push(f);
  }
  const clash = collidingPaths(wellFormed);
  for (const f of wellFormed) {
    if (clash.has(f.path)) { failed.push({ path: f.path, why: 'another entry lands on the same file or folder' }); continue; }
    const why = await restoreFile(f, { memberSk, namingKey, fetchChunk, sink, maxChunkObject });
    if (why) failed.push({ path: f.path, why });
    else restored.push(f.path);
  }
  const skippedAtBackup = (Array.isArray(manifest.skipped) ? manifest.skipped : [])
    .filter((x) => x && typeof x.path === 'string' && typeof x.why === 'string').map(({ path, why }) => ({ path, why }));
  return { restored, failed, skippedAtBackup };
}

/* One file: null when committed, otherwise why it was not. Never leaves a file committed that did not verify. */
async function restoreFile(f, { memberSk, namingKey, fetchChunk, sink, maxChunkObject }) {
  if (!f.chunks.every((n) => typeof n === 'string' && CHUNK_NAME_RE.test(n))) return 'a chunk name is malformed';
  let out = null;
  try {
    out = await sink.begin(toSinkPath(f.path));
    const hash = crypto.createHash('sha256');
    let size = 0;
    for (const name of f.chunks) {
      let obj;
      try { obj = await fetchChunk(name); } catch { return await abortWith(out, 'a chunk could not be fetched'); }
      if (obj == null) return await abortWith(out, 'a chunk is missing');
      if (!(obj instanceof Uint8Array)) return await abortWith(out, 'a chunk did not verify (forged, swapped or damaged)');
      if (obj.length > maxChunkObject) return await abortWith(out, 'a chunk is larger than any real chunk');
      if (!Buffer.isBuffer(obj)) obj = Buffer.from(obj.buffer, obj.byteOffset, obj.length);
      const pt = openVerifiedChunk(memberSk, namingKey, name, obj);
      if (!pt) return await abortWith(out, 'a chunk did not verify (forged, swapped or damaged)');
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
