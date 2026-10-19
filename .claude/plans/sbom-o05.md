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
- **`tools/build-tmux-from-source.sh` at the app commit:** only the NAMES of the libraries it fetches, each of which
  the bundle must name (a library the script fetches and the bundle does not name refuses). Nothing else is taken
  from the script, and the tmux parts carry no source download reference (decided after review 11, see below);
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
- **`tools.sbom-o05.test.js`:** 31 arms. The command line is run END TO END (review 10): a copy of the tool in a temp
  folder, next to a stand-in engine/manifest-verify.js that pins a test key, signs and builds, and the file it writes
  must equal build()'s output byte for byte. Every rule added in reviews 1 to 11 has a mutant that fails an arm,
  run at the time of the change (four, eight, six, eleven, six, seven, nine, eleven, nine, four, eleven and eight per
  round); the mutants of code later removed (the script's variable and url parsing) were retired with it. Every
  field the SBOM vouches for has an assertion (review 11: the release hash, node's purl, cpe and download, each
  part's type, purl and cpe, the ncurses cpe). Equivalent survivors: review 4's whitespace class after the line
  split; review 10's signature length guard (crypto.verify refuses other lengths) and edge de-duplication.
- **The Mac app is checked, not stated** (review 10): the shipped app/bin/kosmos-app must hash to the manifest's
  signed native_app.signed_sha256, and native-app/main.swift at the app commit may import only Apple frameworks
  (an allowlist); a Swift package or another module refuses.
- **The connector crate is the binary's crate:** the relay workspace member kosmos-tunnel-client must declare the
  [[bin]] kosmos-tunnel, and the lockfile must hold exactly one such package.
- **The first-party claim is checked, not stated** (reviews 6 and 7): every path in the signed manifest's file list
  must be VERSION, bin/kosmos, runtime/bin/node, runtime/LICENSE, app/server.js, app/package.json, under app/engine/,
  app/web/ or app/assets/, a script (.sh, .js) or one of the two named binaries (kosmos-app, kosmos-tunnel) directly
  in app/bin/, or one of the Mac app's own files (its executable, Info.plist, signature files, .icns). Native code is
  exact because it is where a third-party addition would most likely go (review 7 showed a Sparkle framework inside
  Kosmos.app passing the earlier prefix rule), and under app/engine/, app/web/ and app/assets/ only text and image
  file types are accepted (review 8: a .node addon, a .dylib, a .wasm or an extensionless binary there refuses).
  A path may appear once. Any node_modules refuses; package.json at the app commit must be the shipped
  app/package.json byte for byte (review 8), and package.json at the app commit may name
  no dependencies of any kind. The real 0.7.59 list (364 files) passes, and its SBOM is unchanged.
  LIMIT: a third-party file copied into a first-party place (a vendored script under app/web/) is not detectable from
  paths; it would need a content check, and none of today's files is one (review 5 read them).
- **The build script is read, not run, and supplies only the names it fetches** (decided after review 11). Reviews 7
  to 11 each found a new way for a static reading of the shell script to be wrong: a download outside fetch(), a #
  inside a string, a one-line fetch() widening an exempt region, a fetch input set in another shape, a helper
  variable re-set after the fetch. Each was patched and the next round found another. The values read (each part's
  source url and hash) were nice to have and vouched for nothing that ships, so they are gone rather than patched a
  sixth time. What remains is exact: every non-comment line that calls fetch must be one call in the one known shape,
  a *_URL= line nothing fetches refuses, a library fetched twice refuses, and every fetched name must be named by the
  bundle. WHAT SHIPS is decided by the signed manifest and the bundle (its signed hash, its VERSION, its lib/, plain
  files only, the binary's own version line), never by the script.
- **The bundle holds plain files and folders only** (review 8): a symlink or hard link refuses (both have an arm).
- **The binary's own version line** (`tmux: tmux 3.5a`) must equal the source it was built from (`tmux-src`).
- **The connector and node are tied to shipped files:** the manifest must ship app/bin/kosmos-tunnel with the
  connector's signed sha256, and runtime/bin/node. Commits must be full shas, and the manifest must say `dirty: false`.
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
- The second native binary, app/Kosmos.app/Contents/MacOS/Kosmos (a re-signed copy of kosmos-app, so a different
  hash), is accepted by name; and a static C library brought into the Mac app by a bridging header or a linker flag,
  not an import, would not be seen.
- A vendored third-party crate made a member of the relay workspace passes as first-party.
- Out of scope: the provider tools (Claude Code, Codex and so on) Kosmos downloads later, when a person asks; the
  installer itself installs none of them.
- A library linked statically into tmux and not recorded in the bundle's VERSION. Nothing in a built bundle shows
  it; the build script records every input today (four, all in VERSION).
- The release tarball is not read: its hash comes from the signed manifest, whose file list is exhaustive by
  construction (the bundle build lists every file of the same stage it packs, and refuses anything that is not a plain
  file; on an update the installed copy also checks every file against it). The shipped runtime/bin/node is not tied to the nodejs.org hash here; the bundle build checks
  it against nodejs.org's SHASUMS256 before packing.
- Of the shipped files, only app/package.json, app/bin/kosmos-tunnel and app/bin/kosmos-app are tied by hash (to
  git, the connector record and the Mac app record).
- That the connector binary was built from the Cargo.lock at its recorded relay commit: the commit is the relay
  build's own record (its sidecar); this tool does not rebuild the connector to check it.
- Node's own bundled libraries (V8, OpenSSL and so on) are not listed one by one. Node is one component, matched
  through its version.
- The Rust standard library compiled into the connector. The relay pins no toolchain, so no rustc version is recorded
  to list; recording `rustc -V` beside the connector is a follow-up.
- `readSignedManifest` repeats engine/manifest-verify.js's signature check (eight lines) instead of calling its
  `verify()`: that function also applies the update rules (the version must be newer than an installed one), which do
  not belong in an SBOM, so calling it would mean passing a made-up installed version. Both use the same KEYS list.
- Only the arm64 Mac release: any other arch refuses (a Node download name differs per arch).

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
