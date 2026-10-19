# sbom-o05: a bill of materials for each release (external review item O05)

The external review asks for an SBOM of what ships. Kosmos has none. This adds `tools/lib/sbom.js`, which writes a
CycloneDX 1.5 JSON SBOM for one Mac release, derived only from records that already exist:
- **the release's signed manifest:** version, tarball sha, app commit, Node version and download sha, the connector's
  signed sha and its relay commit;
- **`tools/build-tmux-from-source.sh` at the app commit:** tmux, libevent and ncurses versions and source sha256;
- **the relay's `Cargo.lock` at the connector commit:** walked from `kosmos-tunnel-client` to every crate it reaches.

The app has no npm dependencies (package.json lists none) and the Swift app links Apple frameworks only, so that is
all the third-party code in the bundle.

## Why derived, not generated at build time
Any served release's SBOM can be rebuilt later, on any machine, from its signed manifest. The manifest is signed, so
the inputs are the ones the release vouched for. The same release always gives a byte-identical file (the serial
number is derived from the tarball sha).

## Checked
- **Real release, 0.7.59 (served manifest):** 233 components:
  - node 24.19.0, tmux 3.5a, libevent 2.1.12-stable, ncurses 6.5, the connector;
  - 227 registry crates and 1 first-party crate.
  - The control: rustls reads 0.23.43, the version that release shipped before the O05 fix (#457, 0.23.46).
- **Against the 189 crates measured earlier for the connector:** none is missing from the SBOM. The 40 extras are
  Windows-only and dev-only crates, the stated superset.
- **`tools.sbom-o05.test.js`:** 6 arms through injected git reads (no relay checkout needed in CI). Four mutants each
  fail an arm: no transitive walk, ignoring a dependency's version, guessing an ambiguous bare name, dropping
  first-party crates.
- **Full-suite-only guards:** every-test-runs, all-node-tests-considered, engine.reachable, #1732, #1777 and the mktemp
  lint pass.

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
