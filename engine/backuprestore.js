/**
 * kosmos#5536 (E0.7, restore) step 3, its pure part: turn one backed-up snapshot back into files.
 * Design v2.1 on #5536 and E0.6's on #5535. No I/O: the caller supplies the manifest object, a way to fetch each
 * chunk object by its name, and the keys a release handed it. Built on engine/backupformat.js.
 *
 *  - The manifest is opened only with the device public key that was enrolled for that member AT THE SNAPSHOT'S
 *    TIME (the caller looks it up in E0.2's device history), so a later or foreign device key proves nothing.
 *  - Every chunk goes through openVerifiedChunk (decrypt, then check the content against its HMAC name), and
 *    every file is checked against the sha256 the manifest recorded at upload.
 *  - Paths must stay inside the restored world (no absolute paths, no '..', no NUL).
 *  - FAIL CLOSED per file: a file whose chunk is missing, forged or mismatched is reported, never written half.
 *  - A shrink check: comparing two snapshots' file counts and bytes flags a sudden shrink (E0.6 v2: restore never
 *    trusts "latest"; a person picks, warned).
 */
const crypto = require('crypto');
const { openManifest, openVerifiedChunk } = require('./backupformat');

function safeRel(p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return !parts.some((x) => x === '..' || x === '');
}

/**
 * Restore one snapshot. Returns { files: [{ path, data }], failed: [{ path, why }], skippedAtBackup: [...] } or null
 * when the manifest itself does not verify and open (wrong device key for the time, wrong context, tampering).
 * fetchChunk(name) -> Buffer | null (the chunk object stored under that name, or null when missing).
 */
function restoreSnapshot({ memberSk, namingKey, devicePubAtSnapshot, ctx, manifestObject, fetchChunk }) {
  const manifest = openManifest(memberSk, devicePubAtSnapshot, ctx, manifestObject);
  if (!manifest || !Array.isArray(manifest.files)) return null;
  const files = [], failed = [];
  for (const f of manifest.files) {
    if (!f || !safeRel(f.path) || !Array.isArray(f.chunks) || typeof f.sha256 !== 'string') {
      failed.push({ path: f && typeof f.path === 'string' ? f.path : '(unnamed)', why: 'malformed entry or unsafe path' });
      continue;
    }
    const parts = [];
    let why = null;
    for (const name of f.chunks) {
      let obj = null;
      try { obj = fetchChunk(name); } catch { obj = null; }
      if (!obj) { why = 'a chunk is missing'; break; }
      const pt = openVerifiedChunk(memberSk, namingKey, name, obj);
      if (!pt) { why = 'a chunk did not verify (forged, swapped or damaged)'; break; }
      parts.push(pt);
    }
    if (!why) {
      const data = Buffer.concat(parts);
      if (crypto.createHash('sha256').update(data).digest('hex') !== f.sha256) why = 'the file does not match the hash recorded at upload';
      else { files.push({ path: f.path, data }); continue; }
    }
    failed.push({ path: f.path, why });
  }
  return { files, failed, skippedAtBackup: Array.isArray(manifest.skipped) ? manifest.skipped : [] };
}

/** A warning when the newer snapshot holds far less than the older one (a possible hiding attack). Null otherwise. */
function shrinkWarning(older, newer, { files = 0.5, bytes = 0.5 } = {}) {
  const count = (m) => (Array.isArray(m && m.files) ? m.files.length : 0);
  const size = (m) => (Array.isArray(m && m.files) ? m.files.reduce((n, f) => n + (Number.isSafeInteger(f && f.size) ? f.size : 0), 0) : 0);
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
