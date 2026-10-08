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
 *  - Paths are refused unless they are plain relative paths (see safeRel), and entries that would land on the
 *    same file, or on a file and a folder of the same name, are all refused.
 *  - Files stream through the sink one chunk at a time; a file is committed only after all of it verified, and
 *    aborted otherwise.
 */
const crypto = require('crypto');
const { openManifest, openVerifiedChunk } = require('./backupformat');

const CHUNK_NAME_RE = /^[0-9a-f]{64}$/;
// Windows device names, with or without an extension (CON, nul.txt, COM1.log).
const WIN_RESERVED_RE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 4096) return false;
  if (/[\x00-\x1f\x7f:]/.test(p)) return false;  // control characters; ':' is a drive or an NTFS stream
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  // A segment may not be empty or end in a dot or a space: that refuses '.' and '..' too, and the names Windows
  // silently trims to another file's name.
  return p.split(/[\\/]/).every((x) => x !== '' && !/[. ]$/.test(x) && !WIN_RESERVED_RE.test(x));
}

/* The key two entries collide on: case-folded (APFS and NTFS are usually case-insensitive) and NFC-normalized
   (APFS treats the composed and decomposed spellings as one name), with '\' read as '/'. */
const collisionKey = (p) => p.replace(/\\/g, '/').normalize('NFC').toLowerCase();

/** Every manifest path that must not be restored because another entry lands on the same file or folder. */
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
 *   fetchChunk(name) -> Buffer | null, or a promise of one (null: the chunk is not stored).
 *   sink.begin(path) -> { write(buf), commit(), abort() } (each may return a promise). The sink owns where and
 *     how bytes land; commit is called only after the whole file verified, abort on any failure.
 *
 * Paths in failed and skippedAtBackup come from the manifest and may hold any printable text: escape them for
 * display.
 */
async function restoreSnapshot({ memberSk, namingKey, devicePubAtSnapshot, ctx, manifestObject, fetchChunk, sink }) {
  const manifest = openManifest(memberSk, devicePubAtSnapshot, ctx, manifestObject);
  if (!manifest || !Array.isArray(manifest.files)) return null;
  const restored = [], failed = [];
  const wellFormed = [];
  for (const f of manifest.files) {
    if (!f || !safeRel(f.path) || !Array.isArray(f.chunks) || typeof f.sha256 !== 'string' || !Number.isSafeInteger(f.size) || f.size < 0) {
      failed.push({ path: f && typeof f.path === 'string' ? f.path : '(unnamed)', why: 'malformed entry or unsafe path' });
    } else wellFormed.push(f);
  }
  const clash = collidingPaths(wellFormed);
  for (const f of wellFormed) {
    if (clash.has(f.path)) { failed.push({ path: f.path, why: 'another entry lands on the same file or folder' }); continue; }
    const why = await restoreFile(f, { memberSk, namingKey, fetchChunk, sink });
    if (why) failed.push({ path: f.path, why });
    else restored.push(f.path);
  }
  return { restored, failed, skippedAtBackup: Array.isArray(manifest.skipped) ? manifest.skipped : [] };
}

/* One file: null when committed, otherwise why it was not. Never leaves a file committed that did not verify. */
async function restoreFile(f, { memberSk, namingKey, fetchChunk, sink }) {
  if (!f.chunks.every((n) => typeof n === 'string' && CHUNK_NAME_RE.test(n))) return 'a chunk name is malformed';
  let out = null;
  try {
    out = await sink.begin(f.path);
    const hash = crypto.createHash('sha256');
    let size = 0;
    for (const name of f.chunks) {
      let obj;
      try { obj = await fetchChunk(name); } catch { return await abortWith(out, 'a chunk could not be fetched'); }
      if (obj == null) return await abortWith(out, 'a chunk is missing');
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
