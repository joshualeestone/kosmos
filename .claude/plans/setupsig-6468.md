# #6468 ask 3 plan draft (Angel, 2026-10-18 05:55 CDT). Build after manifestsig-6468 merges; branch setupsig-6468.

## Finished looks like
An in-app Mac update (engine/update.js beginInstall, and `kosmos update` in install/kosmos cmd_update) never runs an
installer script it has not checked. It downloads the channel's /setup to a private file, has the INSTALLED copy's
node + engine/manifest-verify.js check it against the SIGNED manifest of the version it is updating to, and only then
runs that file. A mismatch, a missing signature or a missing manifest runs nothing and says why.

## Design (decided; supersedes the "ship setup.sh in the bundle" idea on the card)
- The build records `setup_sha256` (sha of install/setup.sh) in the manifest it already writes. The signature then
  covers the installer too. No second key, no new file.
- Premise CHECKED: the installer only changes with a cut. deploy-site.sh (#5032) refuses a committed /setup that does
  not hash to the pointer's setup_sha256; promote copies setup-staging onto /setup with the pointer. release.sh 5
  diff-checks dist/setup against install/setup.sh at the frozen tree the bundle is built from.
- engine/manifest-verify.js gains a `setup` mode: signature, version (equals the target, not older than installed),
  and sha of the downloaded installer == manifest.setup_sha256. Exit 0/1/3 as today.
- update.js: replace `curl -fsSL "$1" | sh` with: curl to a mktemp file, then the installed node runs the installed
  verifier in setup mode, then `sh <file>`. Same status-file contract. Same change in install/kosmos cmd_update.
- Rejected: shipping setup.sh in the bundle and running the installed copy (installer fixes land a release late;
  the hybrid needs the same check anyway). Rejected: a second signature over /setup alone (a second thing to sign
  and serve, when the manifest already has a signature and a version).

## Weakest premise
That nothing else runs an unchecked installer: the Mac app (native-app/main.swift) runs `bin/kosmos update`, so it
goes through cmd_update; any other caller of setupUrl() must be found and converted (grep before building).

## Order of transition
Manifests built before this have no setup_sha256: setup mode exits 3 for them (nothing to check), so the first
release with this still updates from an older pointer. Once prod's release carries setup_sha256, every later update
from it is checked.

## Tests
- verifier setup mode: good, tampered installer, wrong version, older, no setup_sha256 (exit 3), no key (3).
- update.js: the spawned command downloads, verifies, runs only on 0; the existing curl|sh refuse-in-tests guard
  (liveExec) stays.
- cmd_update: same arms with a file:// base.

## Premise checked 05:57
The only runners of the site installer: engine/update.js beginInstall (curl|sh, line ~1238) and install/kosmos cmd_update (given setupUrl() by engine/update-ifnewer.js). native-app has no direct /setup URL.

## Built (06:40)
- engine/manifest-verify.js: verifySetup (signature, version, not older, installer sha == setup_sha256; exit 3 when
  the manifest records none) and run-setup (curl the installer + the target's manifest and .sig into a private
  folder, check, then `sh <file>` with no stdin and NODE_OPTIONS removed; 97 = not run, a sentence on stderr).
- engine/update.js: the spawn runs "$5" "$6" run-setup instead of curl | sh (the installed node and the installed
  verifier); readStatusRecord words 97. install/kosmos cmd_update: the same, logged to install.log.
- tools/build-kosmos-bundle.sh: setup_sha256 (sha of install/setup.sh) in the signed manifest.
- Tests: install.setup-sig-6468.test.js 8; cli.update-ifnewer-4382.test.js 15 (fixture pins a throwaway key and
  publishes signed manifests; 3 new arms: mismatched installer, missing/foreign signature, pre-ask-3 manifest);
  engine/update.test.js's pinned command updated (and asserts no `| sh`). Mutants: refusal removed (2 red),
  NODE_OPTIONS kept (red), stdin passed through (red).
