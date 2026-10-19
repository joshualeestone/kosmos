# pkgpin-6576: a first install from the .pkg checks the signed release

Card: kosmos#6576 (security hardening item; detail kept with the security plan).

## Finished looks like
- On a Mac with no Kosmos, the .pkg checks the release manifest's Ed25519 signature with a key it carries before anything it downloaded runs; the installer it runs, and the Kosmos and tmux downloads, must match the signed sha256 values.
- Anything that does not check out ends the install with one sentence, before anything runs.
- Existing installs keep their own check (#6468, #6474). The install line (curl | sh) is unchanged.
- Shipped switched off until production serves a signed release; one reviewed line turns it on.

## Changes
- install/pkg-verify/main.swift: kosmos-pkg-verify. CryptoKit Ed25519 over the manifest's exact bytes against keys compiled in (equal to engine/manifest-verify.js KEYS; a test pins it); version must equal the pointer's and not be below the floor; prints setup_sha256, sha256, tmux_sha256 only after all three check; refusals exit 97.
- install/pkg-verify/floor: "off" now; the first signed release (0.7.57) turns the check on.
- install/pkg-scripts/postinstall: a root step (the Scripts dir is root-only, #3268) for a Mac whose install has no verifier: downloads pointer, manifest, signature and installer into a root-owned folder, runs the helper, compares the installer's sha256, and hands the checked installer and the two pins to the person's shell, which runs that file and downloads nothing.
- install/setup.sh: pinned_sha_ok after the checksum of the Kosmos and tmux downloads; no pin, no change.
- tools/build-installer-pkg.sh: builds the helper, signs it (Developer ID Application, hardened runtime), stages it and the floor with the scripts. tools/lib/pkg-inputs.sh: install/pkg-verify is a pkg input.

## Rejected
- macOS jsc with a vendored pure-JS Ed25519: jsc is not a supported tool and its path can move.
- A second P-256 signature that LibreSSL can check: a new key and a custody change. (Measured: /usr/bin/openssl is LibreSSL 3.3.6 and cannot verify Ed25519.)
- Running the check in the person's shell: it cannot read the Scripts dir.
- A floor taken from the build's version: the pkg is rebuilt only when its inputs change, and staging runs ahead of production, so a build-time floor could refuse production's release.
- Refusing the cut or holding back the pkg until production is signed: the first stops every staging cut, the second fails step 9c (served pkg must match source). The off switch does neither.

## Evidence (2026-10-19)
- Notarization (the weakest premise): a trial pkg built by tools/build-installer-pkg.sh from this branch was notarized and stapled by Apple (spctl: accepted, Notarized Developer ID); the helper inside it carries the Developer ID Application signature with the hardened runtime, accepts the served staging 0.7.59 manifest and refuses a one-byte-tampered copy (97). Not published.
- The helper against the served 0.7.59 release: prints its setup, tarball and tmux sha256 (equal to the served files); controls: tampered manifest, another version, below the floor, garbage signature, all 97.
- install.pkg-verify-6576.test.js 10/10 (perturbed: removing the installer comparison turns a test red).
- Existing: test-pkg-checksum-1670, test-postinstall-inline-quoting, test-install-page-readable-3268, test-pkg-input-guard (59 checks, new #6576 rows), test-pkg-arch-gate-1562 all pass.

## Weakest premise
That the version offered by the unsigned pointer cannot be used to downgrade: the helper refuses a signed release below the floor, but between the floor and the newest, any genuinely signed release is accepted. Raising the floor over time narrows it.

## Residual
- The install line (curl | sh) still trusts HTTPS: the script it fetches is the root of trust there. The .pkg is the checked path.
- A Mac whose install exists but is broken keeps the checksum path (no weaker than today).
