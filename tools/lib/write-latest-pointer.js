'use strict';
// kosmos#2036: the ONE writer of a latest*.json pointer shape.
//
// The prod pointer (release.sh's dist/latest.json) and the staging pointer
// (publish-staging-pointer.sh's dist/latest-staging.json) MUST have the same
// shape, because promote-channel.sh copies the staging pointer verbatim onto
// latest.json -- so a shape the two disagree on would silently downgrade the
// promoted prod pointer relative to a fresh cut's. This was two inlined copies
// of the same node block; a field added to one and not the other would diverge
// with nothing to catch it. There is now one source, called by both.
//
// Inputs come from the environment (the callers already export these), the
// output path is argv[2]:
//   KM_LJ_VERSION KM_LJ_SHA KM_LJ_ARTIFACT KM_LJ_MANIFEST  node write-latest-pointer.js <out>
//
// Key order is part of the shape (a consumer reads either pointer identically),
// so it is fixed here: version, sha256, artifact, manifest. Trailing "\n" kept.
const e = process.env;
const out = process.argv[2];
if (!out) { process.stderr.write('write-latest-pointer: missing output path (argv[2])\n'); process.exit(1); }
for (const k of ['KM_LJ_VERSION', 'KM_LJ_SHA', 'KM_LJ_ARTIFACT', 'KM_LJ_MANIFEST']) {
  if (!e[k]) { process.stderr.write('write-latest-pointer: ' + k + ' is empty; refusing to write a pointer with a missing field\n'); process.exit(1); }
}
require('node:fs').writeFileSync(out, JSON.stringify({
  version: e.KM_LJ_VERSION,
  sha256: e.KM_LJ_SHA,
  artifact: e.KM_LJ_ARTIFACT,
  manifest: e.KM_LJ_MANIFEST,
}) + '\n');
