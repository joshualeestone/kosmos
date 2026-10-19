# sbom-o05: a bill of materials for each release (external review item O05)

The external review asks for an SBOM of what ships. Kosmos has none. This adds `tools/lib/sbom.js`, which writes a
CycloneDX 1.5 JSON SBOM for one Mac release, derived only from records that already exist:
- **the release's signed manifest:** version, tarball sha, app commit, Node version and download sha, the connector's
  signed sha and its relay commit;
- **the tmux bundle the release shipped** (`tmux-<arch>.tar.gz`, given with `--tmux`), which must hash to the
  manifest's signed `tmux_sha256`: its VERSION file names the tmux, libevent, ncurses and utf8proc that were built,
  and every dylib in its `lib/` must belong to one of them. Review 3 found the first versions of this tool read the
  versions from the build SCRIPT; but a release copies an already-built bundle and does not rebuild it (release.sh
  step 4), so a pin bumped without a rebuild would have listed a version users do not have;
- **`tools/build-tmux-from-source.sh` at the app commit:** only for each input's download url and source sha256, and
  only where its pinned version equals the bundle's; otherwise the component carries a `kosmos:source-pin` property
  saying what differs, and no source reference. Every `fetch` call is read, anywhere on a line, and one in a shape
  it cannot read, or a `*_URL` nothing fetches, refuses;
- **the relay's `Cargo.lock` at the connector commit:** walked from `kosmos-tunnel-client` to every crate it reaches,
  with each crate's DIRECT dependencies as the CycloneDX dependency graph. A crate from a source the tool does not know
  (not crates.io exactly, not git) refuses the whole SBOM rather than being left out, and so does a sourceless crate
  that is not a member of the relay workspace (a vendored crate would otherwise pass as first-party).

The app has no npm dependencies (package.json lists none) and the Swift app links Apple frameworks only, so that is
all the third-party code in the bundle.

## Why derived, not generated at build time
Any served release's SBOM can be rebuilt later, on any machine, from its signed manifest. The manifest is signed, so
the inputs are the ones the release vouched for. The same release always gives a byte-identical file (the serial
number is derived from the tarball sha). LIMIT (review 5): the tmux bundle is served under one unversioned name, so
an older release's SBOM can be rebuilt only while the bundle it shipped is still the one served (or kept); once tmux
is rebuilt, the old release refuses on the hash, the safe direction. Publishing the SBOM at the cut (below) is the
real fix.

## Checked
- **Real release, 0.7.59 (served manifest and the served tmux bundle, whose sha256 equals the signed tmux_sha256):**
  235 components:
  - node 24.19.0, the tmux bundle, tmux 3.5a, libevent 2.1.12-stable, ncurses 6.5, utf8proc 2.9.0, the connector;
  - the control: a bundle with one byte appended refuses ("not the one this release signed");
  - 227 registry crates and 1 first-party crate.
  - It passes the official CycloneDX 1.5 JSON schema (ajv), and a copy with one bad component type fails it.
  - CPEs only for names NVD has (node, tmux, libevent without -stable, ncurses; none for utf8proc).
  - Purl versions are percent-encoded (`wasi@0.11.1%2Bwasi-snapshot-preview1`).
  - It is byte-identical under the C, en_US and da_DK locales (code-point order; locale-aware sorting changed it under
    da_DK, found in review 1).
  - The control: rustls reads 0.23.43, the version that release shipped before the O05 fix (#457, 0.23.46).
- **Against `cargo tree` (review 1, offline, locked):** none of its 189 macOS crates is missing. Of the 40 extras,
  26 are Windows-only or dev-only and 14 are optional dependencies of features the connector does not turn on (h2 and
  untrusted 0.7.1 among them). So a scan of this SBOM must treat an advisory on an extra crate as NOT shipped until it
  checks the macOS build graph; the header says so.
- **`tools.sbom-o05.test.js`:** 21 arms, all in-process with injected reads, a test key or small fixtures it makes
  (tmpscope); the command line is run for its refusals and usage errors. Forty-two mutants each fail an arm (seven
  more after review 5: a fetched library the bundle does not name accepted, a non-sha256 hash accepted, the
  connector's own ref left dangling, libevent's -stable suffix kept in its CPE, the VERSION `source` key dropped
  (the real VERSION text is now the fixture), a utf8proc CPE restored, the old git purl). One survives and is
  equivalent (see review 4 below).
- **The manifest's signature is verified** under the checkout's pinned keys (engine/manifest-verify.js) before
  anything is read from it. The real 0.7.59 manifest and its served .sig verify; the same manifest with its version
  changed refuses. The command line's success path cannot run in a test, since only the real release key signs; it
  is the same three calls the in-process arm makes, and the CLI arm checks it refuses an unsigned manifest.
- **The bundle allowlist:** every file must be the VERSION file, a notice or licence, bin/tmux, or a dylib of a library
  the VERSION names. The real 0.7.59 bundle passes it; nine other shapes (a digit or a + in a dylib name, a
  subdirectory, libexec/, a bin/ helper, a .so, a .a, terminfo data) each refuse.
- **Every refusal names what it could not read,** so a new build-script shape fails loudly at SBOM time instead of
  going missing (review 2: the fetch-line approach is only as good as its refusal on a line it cannot parse).
- **Full-suite-only guards:** every-test-runs, all-node-tests-considered, engine.reachable, #1732, #1777 and the mktemp
  lint pass.

## Not covered, by design
- Node's own bundled libraries (V8, OpenSSL and so on) are not listed one by one. Node is one component, matched
  through its version.
- The Rust standard library compiled into the connector. The relay pins no toolchain, so no rustc version is recorded
  to list; recording `rustc -V` beside the connector is a follow-up.
- `readSignedManifest` repeats engine/manifest-verify.js's signature check (eight lines) instead of calling it: the
  shipped verifier's exports are not changed in a tooling PR. Both are pinned to the same KEYS list.

## Not in this PR (named, owner Baron)
- **Publishing:** the SBOM beside each release (`dist/kosmos-<V>-arm64.cdx.json`), written at release step 4b and
  covered by the signed manifest. A release-surface change, so a separate PR after the 0.7.60 hold lifts.
- **The vulnerability scan:** a CI job that checks the SBOM's purls against OSV (the scan done by hand for O05 found
  the rustls advisories). Next.
- **Windows:** the Windows bundle's SBOM, once its signed manifest (#6607) ships.

## Weakest premise
That the lockfile closure is an acceptable SBOM for the connector. It over-lists (Windows and test crates) rather than
under-lists. A reviewer may prefer the exact macOS build graph (`cargo tree --target aarch64-apple-darwin -e normal`),
but that needs a relay checkout with cargo at SBOM time and loses the any-machine property.
