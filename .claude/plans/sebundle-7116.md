# sebundle-7116: ship kosmos-se, the Secure Enclave admin signer, in the release bundle (app/bin, beside kosmos-app) (kosmos#7116 step 2)

Baron 11-19 14:33 (release owner): "you add it, and I review." His three rules: every list must name bin/kosmos-se, with a check that FAILS when it is absent, proven red; sign it in the same step and with the same identity as kosmos-app, before the bundle is sealed and notarised; a cut pinned before this merge simply does not carry it (release-freeze.sh hashes what ships).

## Finished looks like
Every Kosmos release built from a tree with native-se/main.swift carries app/bin/kosmos-se: compiled to the floor, Developer ID signed with hardened runtime and kosmos-app's identity before the seal, notarised with the other binaries, listed in the SBOM with its source checked, and a bundle without it refused before anything is published (step 4b) and on the served bytes (step 9b).

## What changed
- tools/build-kosmos-bundle.sh: compile native-se/main.swift to app/bin/kosmos-se (floor target), sign as kosmos-app is (no entitlements: the key file is a blob only this Mac's Enclave can use), verify --strict, run it (usage exit 2 proves it loads under hardened runtime), all before the sealed Kosmos.app; and notarize_binaries includes it.
- tools/lib/release-freeze.sh: release_bundle_matches_tree checks app/bin/kosmos-se by its signature (identifier kosmos-se, plus the cut's team requirement) and its executable bit, and refuses a SEALED bundle without it when the tree has native-se/main.swift. A 7th optional argument is its expected sha256 (review 3): tools/release.sh takes it from the built tarball (SE_SHA, as NATIVE_APP_SHA) and passes it at both calls (4b, built; 9b, served); every other caller passes fewer arguments and is unchanged.
- tools/lib/sbom.js: app/bin/kosmos-se is first-party; when shipped, native-se/main.swift must import Apple frameworks only (CryptoKit and LocalAuthentication added).
- Tests: tools/test-kosmos-se-bundle-7116.sh (red: a sealed bundle without it is refused by name; controls), in test:shell and the macOS-only list; tools.sbom-kosmosse-7116.test.js.

## Not changed, and why
- tools/kosmos-artifact-check.sh (9e) discovers every Mach-O and gates its floor and signature: it covers kosmos-se once present; presence is 4b's and 9b's.
- tools/check-served.js reads page and app markers, not the binary list.
- install/setup.sh's install checks: Kosmos runs without kosmos-se, so an install must not refuse a bundle for lacking it. (Its update-signer check DOES name it, review 1: an installed kosmos-se is held to the installed signer, and a part not installed is skipped.)

## Weakest premise
That the real build signs and notarises it cleanly: only measured here with an ad-hoc signature and a floor build (minos 13.5, no home paths, usage exit 2). The first real cut is the test; Baron names the merge sha in it.
