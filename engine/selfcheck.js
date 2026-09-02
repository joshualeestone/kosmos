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
 *
 * SCOPE / THREAT MODEL (stated so the guarantee is not over-read): this detects DISK
 * integrity -- bit-rot, a truncated/partial install, accidental local modification. The
 * fetched manifest is authenticated by TLS ALONE: latest.json's sha256 is the *tarball*
 * digest, not the manifest's, so nothing here binds the served manifest to the published
 * release. An adversary who can serve or alter the manifest can also serve matching
 * per-file shas and get a pass. Detecting that needs the manifest's own sha in latest.json
 * (a follow-up) -- until then this is a bit-rot/accidental-corruption check, not an
 * anti-tamper boundary, matching tools/verify-manifest.sh's existing trust model.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { installedRoot } = require('./update');

// The published release base. Kept in sync with engine/update.js's default by
// convention; the CLI/callers may override, and the tests always inject their own.
const DEFAULT_BASE = process.env.AGENT_WORKFORCE_RELEASE_BASE || 'https://installkosmos.com/dist';

// Stream the file so a large runtime binary is not read wholly into memory. createReadStream
// FOLLOWS symlinks -- deliberate: the build hashes each file with `shasum` (which also follows
// links), so hashing the link target matches how the manifest sha was recorded. escapesRoot
// guards only the lexical manifest PATH, not a symlink target; within the card's disk-integrity
// scope (a trusted manifest) that is sufficient, and it avoids rejecting a legitimately-linked
// bundle file.
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
  // `rel === '..'` or a `..<sep>` prefix means the path climbed out of root; an absolute
  // rel (Windows drive change) escapes too. Match the separator so a legitimate file
  // literally named `..foo` at the root is NOT rejected.
  return rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
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
    } catch (e) {
      // ENOENT is a genuinely absent file; anything else (EACCES, EISDIR) is present but
      // unreadable -- a distinct cause, reported as `bad` rather than mislabelled missing.
      if (e && e.code === 'ENOENT') missing.push({ path: f.path, expected: f.sha256 });
      else bad.push({ path: f.path, reason: 'unreadable (' + ((e && e.code) || (e && e.message) || 'error') + ')' });
      continue;
    }
    checked += 1;
    if (actual !== f.sha256) mismatches.push({ path: f.path, expected: f.sha256, actual });
  }
  const ok = checked > 0 && mismatches.length === 0 && missing.length === 0 && bad.length === 0;
  return { ok, checked, mismatches, missing, bad };
}

// The installed version, read from the bundle's own app/package.json -- the same source
// setup.sh and update.js treat as authoritative. Returns null if it cannot be read.
function installedVersion(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8')).version || null;
  } catch (_e) { return null; }
}

// The manifest is versioned (kosmos-<v>-<arch>.manifest.json). Derive the name for a
// specific version, keeping the arch the published pointer uses (defaulting to arm64, the
// only arch released today).
function manifestNameFor(version, latestManifestName) {
  const m = /^kosmos-.+-([^-]+)\.manifest\.json$/.exec(latestManifestName || '');
  const arch = m ? m[1] : 'arm64';
  return `kosmos-${version}-${arch}.manifest.json`;
}

async function fetchJson(f, url) {
  const res = await f(url, { cache: 'no-store' });
  return res && res.ok ? await res.json().catch(() => null) : null;
}

// Fetch latest.json; throw if it carries no manifest pointer (a pre-#1920 release, or the
// field was dropped). Failing loudly here is deliberate: an unreachable/absent pointer must
// never resolve to a vacuous pass.
async function fetchLatestJson({ base = DEFAULT_BASE, doFetch } = {}) {
  const f = doFetch || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('no fetch available to retrieve latest.json');
  const lj = await fetchJson(f, `${base}/latest.json`);
  if (!lj || typeof lj.manifest !== 'string' || lj.manifest === '') {
    throw new Error('latest.json has no manifest pointer (a pre-#1920 release, or the field was dropped)');
  }
  return { latest: lj, fetch: f };
}

// Fetch a manifest by name; throw if unreachable/unparseable. An unreachable manifest must
// NEVER read as a passing self-check -- that false absence is the mistake that made this card.
async function fetchManifestNamed({ base = DEFAULT_BASE, name, doFetch } = {}) {
  const f = doFetch || (typeof fetch === 'function' ? fetch : null);
  if (!f) throw new Error('no fetch available to retrieve the manifest');
  const man = await fetchJson(f, `${base}/${name}`);
  if (!man || !Array.isArray(man.files)) {
    throw new Error(`manifest ${name} is unreachable or has no files[] to verify against`);
  }
  return man;
}

// Back-compat helper: fetch the LATEST published manifest via the latest.json pointer.
// (selfCheck deliberately does NOT use this -- it verifies the installed version, below.)
async function fetchManifest({ base = DEFAULT_BASE, doFetch } = {}) {
  const { latest, fetch: f } = await fetchLatestJson({ base, doFetch });
  const manifest = await fetchManifestNamed({ base, name: latest.manifest, doFetch: f });
  return { manifest, latest };
}

/**
 * selfCheck({ base, root, doFetch }) -> verifyFiles result + context.
 * Verifies the installed bundle against the manifest for the version IT is running (NOT the
 * newest), so a machine one release behind -- the normal pre-update window, and the exact
 * "cannot update, want to self-check" case -- matches what IT received instead of
 * mismatching every file. `behind` reports the merely-behind state distinctly. Returns
 * { ok:false, reason } for a from-source checkout or when the installed version is unreadable.
 */
async function selfCheck({ base = DEFAULT_BASE, root, doFetch } = {}) {
  const installed = root || installedRoot();
  // `installed` (boolean) discriminates the two ok:false-with-reason cases the CLI must
  // treat differently: a from-source checkout is benign (exit 0), but an INSTALLED machine
  // we could not read a version off is a real integrity defect (exit 1) -- an unreadable
  // bundle package.json must not report clean.
  if (!installed) {
    return { ok: false, installed: false, reason: 'not an installed bundle (running from source) -- nothing to self-check' };
  }
  const iv = installedVersion(installed);
  if (!iv) {
    return { ok: false, installed: true, reason: `could not read the installed version from ${installed}/app/package.json` };
  }
  const { latest } = await fetchLatestJson({ base, doFetch });
  const name = manifestNameFor(iv, latest.manifest);
  const manifest = await fetchManifestNamed({ base, name, doFetch });
  // Cross-check: the manifest we fetched must be FOR the installed version, or the name
  // derivation/serving is wrong and a pass would be meaningless.
  if (manifest.version && manifest.version !== iv) {
    throw new Error(`manifest ${name} is for ${manifest.version}, not the installed ${iv}`);
  }
  const res = await verifyFiles(installed, manifest.files);
  return { ...res, installed: true, root: installed, installedVersion: iv, latestVersion: latest.version, behind: iv !== latest.version };
}

// reportLines(r) -> { code, out[], err[] } : the CLI's rendering + exit code, extracted as a
// PURE function so it is testable (the CLI is the main user-facing surface and had an
// `undefined`-printing bug precisely because nothing exercised it). Exit-code contract:
//   ok                                -> 0, a success line (noting `behind` if applicable)
//   from-source (installed === false) -> 0, "nothing to check"
//   installed but NOT ok              -> 1, the mismatches/missing/bad or the reason
function reportLines(r) {
  if (r.ok) {
    const behind = r.behind ? ` (behind latest ${r.latestVersion})` : '';
    return { code: 0, out: [`selfcheck OK: ${r.checked} files match the manifest for ${r.installedVersion}${behind}`], err: [] };
  }
  if (r.installed === false) {
    return { code: 0, out: [`selfcheck: ${r.reason}`], err: [] };
  }
  const err = [`selfcheck FAILED${r.root ? ' for ' + r.root : ''}`];
  for (const m of r.mismatches || []) err.push(`  MISMATCH ${m.path}: manifest ${m.expected}, on disk ${m.actual}`);
  for (const m of r.missing || []) err.push(`  MISSING  ${m.path} (manifest ${m.expected})`);
  for (const b of r.bad || []) err.push(`  BAD      ${b.path}: ${b.reason}`);
  if (r.reason) err.push(`  ${r.reason}`);
  return { code: 1, out: [], err };
}

module.exports = {
  verifyFiles, fetchManifest, fetchManifestNamed, fetchLatestJson,
  selfCheck, reportLines, hashFile, installedVersion, manifestNameFor, DEFAULT_BASE,
};

// CLI: `node engine/selfcheck.js` verifies this installed machine against the manifest for
// the version it runs, and exits non-zero on any mismatch/missing/bad file (or an installed
// machine it could not read a version off), so a person or a cron can run it. A verifier
// nobody can invoke is not a verifier. The rendering + exit code live in reportLines() so
// they are testable without spawning the process.
if (require.main === module) {
  selfCheck()
    .then((r) => {
      const { code, out, err } = reportLines(r);
      for (const l of out) console.log(l);
      for (const l of err) console.error(l);
      process.exit(code);
    })
    .catch((e) => { console.error(`selfcheck error: ${e.message}`); process.exit(2); });
}
