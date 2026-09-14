'use strict';
// The ONE writer of a Windows pointer: dist/latest-win.json (prod) and
// dist/latest-win-staging.json (staging). Both come from publish-kosmos-windows.sh.
//
// The two pointers MUST have the same bytes for the same build, because
// `promote-channel.sh --family win` copies the staging pointer verbatim onto
// latest-win.json. Two writers would drift. This is the Windows twin of
// write-latest-pointer.js. Its shape differs (`versioned` and `arch`, and `artifact`
// names the unversioned alias), so it is a separate file rather than a mode of that one.
//
// `artifact` is the stable alias (kosmos-win-<arch>.zip) in BOTH pointers. In a staging
// pointer the alias still serves the prior prod bytes until the promote moves it, so a
// consumer of a staging pointer fetches `versioned` (fixed once published) and never
// `artifact`. Keeping the alias in both is what lets the promote copy the pointer byte
// for byte.
//
// Inputs come from the environment, and the output path is argv[2]:
//   KM_LWP_VERSION KM_LWP_SHA KM_LWP_ARTIFACT KM_LWP_VERSIONED KM_LWP_ARCH \
//     node write-latest-win-pointer.js <out>
//
// The key order is part of the shape and matches what publish-kosmos-windows.sh wrote
// inline before this file existed: version, sha256, artifact, versioned, arch, plus a
// trailing "\n".
const REQUIRED_ENVIRONMENT_FIELDS = ['KM_LWP_VERSION', 'KM_LWP_SHA', 'KM_LWP_ARTIFACT', 'KM_LWP_VERSIONED', 'KM_LWP_ARCH'];
const environment = process.env;
const outputPath = process.argv[2];
if (!outputPath) { process.stderr.write('write-latest-win-pointer: missing output path (argv[2])\n'); process.exit(1); }
for (const field of REQUIRED_ENVIRONMENT_FIELDS) {
  if (!environment[field]) { process.stderr.write('write-latest-win-pointer: ' + field + ' is empty; refusing to write a pointer with a missing field\n'); process.exit(1); }
}
require('node:fs').writeFileSync(outputPath, JSON.stringify({
  version: environment.KM_LWP_VERSION,
  sha256: environment.KM_LWP_SHA,
  artifact: environment.KM_LWP_ARTIFACT,
  versioned: environment.KM_LWP_VERSIONED,
  arch: environment.KM_LWP_ARCH,
}) + '\n');
