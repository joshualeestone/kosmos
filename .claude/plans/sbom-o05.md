# sbom-o05: a bill of materials for each release (external review item O05)

The external review asks for an SBOM of what ships. Kosmos has none. This adds `tools/lib/sbom.js`, which writes a
CycloneDX 1.5 JSON SBOM for one Mac release, derived only from records that already exist:
- **the release's signed manifest:** version, tarball sha, app commit, Node version and download sha, the connector's
  signed sha and its relay commit;
- **`tools/build-tmux-from-source.sh` at the app commit:** every `fetch` line (tmux, libevent, ncurses, utf8proc today),
  with each one's pinned version, download url and source sha256. Reading the fetch lines rather than a list of names
  is deliberate: the first version of this tool listed three names and missed utf8proc;
- **the relay's `Cargo.lock` at the connector commit:** walked from `kosmos-tunnel-client` to every crate it reaches,
  with each crate's DIRECT dependencies as the CycloneDX dependency graph. A crate from a source the tool does not know
  (not crates.io, not git, not a workspace path) refuses the whole SBOM rather than being left out.

The app has no npm dependencies (package.json lists none) and the Swift app links Apple frameworks only, so that is
all the third-party code in the bundle.

## Why derived, not generated at build time
Any served release's SBOM can be rebuilt later, on any machine, from its signed manifest. The manifest is signed, so
the inputs are the ones the release vouched for. The same release always gives a byte-identical file (the serial
number is derived from the tarball sha).

## Checked
- **Real release, 0.7.59 (served manifest):** 234 components:
  - node 24.19.0, tmux 3.5a, libevent 2.1.12-stable, ncurses 6.5, utf8proc 2.9.0, the connector;
  - 227 registry crates and 1 first-party crate.
  - It passes the official CycloneDX 1.5 JSON schema (ajv), and a copy with one bad component type fails it.
  - It is byte-identical under the C, en_US and da_DK locales (code-point order; locale-aware sorting changed it under
    da_DK, found in review 1).
  - The control: rustls reads 0.23.43, the version that release shipped before the O05 fix (#457, 0.23.46).
- **Against `cargo tree` (review 1, offline, locked):** none of its 189 macOS crates is missing. Of the 40 extras,
  26 are Windows-only or dev-only and 14 are optional dependencies of features the connector does not turn on (h2 and
  untrusted 0.7.1 among them). So a scan of this SBOM must treat an advisory on an extra crate as NOT shipped until it
  checks the macOS build graph; the header says so.
- **`tools.sbom-o05.test.js`:** 11 arms, 10 through injected git reads (no relay checkout needed in CI) and 1 through
  the command line against two git repos it makes (tmpscope). Twelve mutants each fail an arm: no transitive walk,
  ignoring a dependency's version, guessing an ambiguous bare name, dropping first-party crates, a flat graph, no sort,
  an unknown source let through, a `[[patch.unused]]` table overwriting a package, ignoring a `(source)` ref, no
  timestamp, git crates refused, and a tmux script with no fetch lines accepted.
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
