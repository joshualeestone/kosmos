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
