'use strict';
/**
 * kosmos#1920 -- after-install self-verification.
 *
 * The gap this closes: a running machine had no way -- online or offline -- to check
 * that what it is running matches what was published. `latest.json` carried only a
 * version, and the per-file release manifest (kosmos-<v>-arm64.manifest.json), though
 * PRODUCED and SERVED beside the versioned tarball (release.sh _site_paths), was not
 * DISCOVERABLE from the pointer every client already fetches, and is not kept on disk.
 *
 * The fix has two halves. release.sh now puts the artifact `sha256` and a `manifest`
 * pointer into latest.json -- the sha lets a client verify what it DOWNLOADED, and the
 * pointer makes the served manifest reachable. This module closes the more useful half:
 * given the manifest's per-file shas and the installed bundle root, re-hash every file
 * on disk and report each mismatch or missing file -- verifying what the machine is
 * STILL running is what it received.
 *
 * The manifest `files` array is [{path, sha256}] over the exact set the tarball packs
 * (bin app runtime VERSION), paths relative to the bundle root (build-kosmos-bundle.sh),
 * so the shas the build recorded are the ones checked here.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { installedRoot } = require('./update');

// The published release base. Kept in sync with engine/update.js's default by
// convention; the CLI/callers may override, and the tests always inject their own.
const DEFAULT_BASE = process.env.AGENT_WORKFORCE_RELEASE_BASE || 'https://installkosmos.com/dist';

// Stream the file so a large runtime binary is not read wholly into memory.
function hashFile(abs) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(abs);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

// A manifest path must stay INSIDE the bundle root. A `files` entry is our own trusted
// artifact, but a self-verifier that would hash a file outside the tree it is checking
// is a verifier that can be pointed at the wrong bytes, so treat an escaping path as a
// verification failure rather than following it.
function escapesRoot(root, p) {
  const rel = path.relative(root, path.resolve(root, p));
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
}

/**
 * verifyFiles(root, files) -> { ok, checked, mismatches, missing, bad }
 *   files:      [{ path, sha256 }] (a manifest's files array)
 *   mismatches: [{ path, expected, actual }] -- present on disk, wrong bytes
 *   missing:    [{ path, expected }]          -- named by the manifest, absent on disk
 *   bad:        [{ path, reason }]             -- unusable entry (escaping path, no sha)
 * `ok` is true ONLY when there is at least one file and every one is present AND matches.
 * An empty/absent files array is NOT ok: there is nothing to verify, and a vacuous pass
 * is exactly the "no way to check" this card exists to close.
 */
async function verifyFiles(root, files) {
  const mismatches = [];
  const missing = [];
  const bad = [];
  let checked = 0;
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, checked: 0, mismatches, missing, bad, reason: 'manifest carried no files to verify' };
  }
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || typeof f.sha256 !== 'string' || f.sha256 === '') {
      bad.push({ path: f && f.path, reason: 'entry missing path or sha256' });
      continue;
    }
    if (escapesRoot(root, f.path)) {
      bad.push({ path: f.path, reason: 'path escapes the bundle root' });
      continue;
    }
    let actual;
    try {
      actual = await hashFile(path.resolve(root, f.path));
    } catch (_e) {
      missing.push({ path: f.path, expected: f.sha256 });
      continue;
    }
    checked += 1;
    if (actual !== f.sha256) mismatches.push({ path: f.path, expected: f.sha256, actual });
  }
  const ok = checked > 0 && mismatches.length === 0 && missing.length === 0 && bad.length === 0;
  return { ok, checked, mismatches, missing, bad };
}

// Fetch the published manifest via the latest.json `manifest` pointer. A self-check that
// cannot obtain the manifest must fail LOUDLY (throw), never resolve to a vacuous pass.
async function fetchManifest({ base = DEFAULT_BASE, doFetch } = {}) {
  const f = doFetch || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('no fetch available to retrieve the manifest');
  const ljRes = await f(`${base}/latest.json`, { cache: 'no-store' });
  const lj = ljRes && ljRes.ok ? await ljRes.json().catch(() => null) : null;
  if (!lj || typeof lj.manifest !== 'string' || lj.manifest === '') {
    throw new Error('latest.json has no manifest pointer (a pre-#1920 release, or the field was dropped)');
  }
  const manRes = await f(`${base}/${lj.manifest}`, { cache: 'no-store' });
  const man = manRes && manRes.ok ? await manRes.json().catch(() => null) : null;
  if (!man || !Array.isArray(man.files)) {
    throw new Error(`manifest ${lj.manifest} is unreadable or has no files[] to verify against`);
  }
  return { manifest: man, latest: lj };
}

/**
 * selfCheck({ base, root, doFetch }) -> verifyFiles result + context.
 * Fetches the published manifest and verifies the installed bundle against it. Returns
 * { ok:false, reason } when this is a from-source checkout (no installed bundle to check).
 */
async function selfCheck({ base = DEFAULT_BASE, root, doFetch } = {}) {
  const installed = root || installedRoot();
  if (!installed) {
    return { ok: false, reason: 'not an installed bundle (running from source) -- nothing to self-check' };
  }
  const { manifest, latest } = await fetchManifest({ base, doFetch });
  const res = await verifyFiles(installed, manifest.files);
  return { ...res, root: installed, manifestVersion: manifest.version, publishedVersion: latest.version };
}

module.exports = { verifyFiles, fetchManifest, selfCheck, hashFile, DEFAULT_BASE };

// CLI: `node engine/selfcheck.js` verifies this installed machine against the published
// manifest and exits non-zero on any mismatch/missing file, so a person or a cron can run
// it. A verifier nobody can invoke is not a verifier.
if (require.main === module) {
  selfCheck()
    .then((r) => {
      if (r.ok) {
        console.log(`selfcheck OK: ${r.checked} files match manifest ${r.manifestVersion} (running ${r.publishedVersion})`);
        process.exit(0);
      }
      if (r.reason && r.checked === undefined) {
        console.log(`selfcheck: ${r.reason}`);
        process.exit(0); // from-source or nothing to check is not a failure
      }
      console.error(`selfcheck FAILED for ${r.root}`);
      for (const m of r.mismatches || []) console.error(`  MISMATCH ${m.path}: manifest ${m.expected}, on disk ${m.actual}`);
      for (const m of r.missing || []) console.error(`  MISSING  ${m.path} (manifest ${m.expected})`);
      for (const b of r.bad || []) console.error(`  BAD      ${b.path}: ${b.reason}`);
      if (r.reason) console.error(`  ${r.reason}`);
      process.exit(1);
    })
    .catch((e) => { console.error(`selfcheck error: ${e.message}`); process.exit(2); });
}
