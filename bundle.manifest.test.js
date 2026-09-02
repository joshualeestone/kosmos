'use strict';
/* #776: a release must be accountable from a commit. Not reproducible: codesign
   embeds a timestamp and binds to the machine, tar and gzip embed mtimes, so the
   bytes cannot be rebuilt and nobody should try. Accountable: given the served
   bytes, what produced them. The bundle build writes a manifest beside the
   tarball, the release commits it beside the pointer, verify-manifest.sh reads
   it back against the wire, and a -dirty tree does not package. Static, so it
   fails at the commit rather than at the cut. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BUILD = fs.readFileSync(path.join(__dirname, 'tools', 'build-kosmos-bundle.sh'), 'utf8');
const RELEASE = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');

test('#776: the bundle build writes a manifest that names the artifact sha, app commit, node download sha, connector, and every file', () => {
  assert.match(BUILD, /MANIFEST_OUT="\$OUT\/kosmos-\$ARCH\.manifest\.json"/);
  for (const key of ['sha256: e.KM_SHA', 'commit: e.KM_APP_COMMIT', 'download_sha256: e.KM_NODE_SHA', 'signed_sha256: e.KM_TUNNEL_SIGNED', 'input_sha256: e.KM_TUNNEL_INPUT', 'commit: e.KM_TUNNEL_COMMIT', 'files,']) {
    assert.ok(BUILD.includes(key), 'manifest no longer records: ' + key);
  }
  /* The node sha is the one the build VERIFIED against nodejs.org, kept, not re-derived. */
  assert.match(BUILD, /NODE_SHA="\$GOT"/);
});

test('#776: a -dirty tree does not package unless a test build says so explicitly', () => {
  assert.match(BUILD, /refusing to package a -dirty tree/);
  assert.match(BUILD, /KOSMOS_ALLOW_DIRTY:-0/);
});

test('#776: the release carries the manifest beside the versioned tarball and COMMITS it', () => {
  assert.match(RELEASE, /cp "\$REPO\/dist\/kosmos-arm64\.manifest\.json" "\$SITE\/dist\/kosmos-\$V-arm64\.manifest\.json"/);
  assert.match(RELEASE, /_site_paths="[^"]*dist\/kosmos-\$V-arm64\.manifest\.json[^"]*"/, 'the manifest is copied but not in the committed site paths: it would be a working-tree side effect, the #649 shape');
});

test('#776: verify-manifest.sh exists, is executable, and checks both the artifact sha and every file', () => {
  const p = path.join(__dirname, 'tools', 'verify-manifest.sh');
  assert.ok(fs.existsSync(p));
  assert.ok(fs.statSync(p).mode & 0o111, 'not executable');
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /MISMATCH: manifest says/);
  assert.match(src, /FILE MISMATCH/);
});

test('#1920: latest.json carries the artifact sha256 and a manifest pointer, not the version alone', () => {
  // The sha must be SOURCED from the .sha256 sidecar that release.sh verifies in place with
  // `shasum -c` just above, so latest.json cannot advertise a digest the served pair rejects.
  assert.match(RELEASE, /KM_ARTIFACT_SHA="\$\(awk '\{print \$1\}' "\$REPO\/dist\/kosmos-arm64\.tar\.gz\.sha256"\)"/,
    'latest.json must read the artifact sha from the verified .sha256 sidecar, not compute a fresh one');
  // The written object carries the sha and a pointer to the served manifest, alongside version.
  assert.match(RELEASE, /sha256: e\.KM_LJ_SHA/, 'latest.json no longer writes the artifact sha256');
  assert.match(RELEASE, /manifest: e\.KM_LJ_MANIFEST/, 'latest.json no longer writes a manifest pointer');
  // The pointer must name the SAME versioned manifest _site_paths commits and serves,
  // or the pointer would 404 -- the discoverability gap this card closes would reopen.
  assert.match(RELEASE, /KM_LJ_MANIFEST="kosmos-\$V-arm64\.manifest\.json"/,
    'the latest.json manifest pointer must match the served versioned manifest name');
});

test('#1920: an after-install self-verifier exists, is runnable, and refuses a vacuous pass', () => {
  const p = path.join(__dirname, 'engine', 'selfcheck.js');
  assert.ok(fs.existsSync(p), 'engine/selfcheck.js is the after-install verifier');
  const src = fs.readFileSync(p, 'utf8');
  // It must be invocable directly (a verifier nobody can run is not a verifier)...
  assert.match(src, /require\.main === module/, 'selfcheck must be runnable as a CLI');
  // ...compare on-disk bytes to the manifest sha (not merely presence)...
  assert.match(src, /actual !== f\.sha256/, 'selfcheck must compare the on-disk sha to the manifest');
  // ...and treat an empty files[] as a FAILURE, not a pass (the vacuous-pass this card is about).
  assert.match(src, /manifest carried no files to verify/, 'an empty manifest must not read as verified');
});
