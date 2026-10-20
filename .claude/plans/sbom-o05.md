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
  with each crate's DIRECT dependencies as the CycloneDX dependency graph. A package key other than name, version,
  source, checksum and dependencies refuses (review 19: Cargo's `replace` points the build at a different crate). A
  crate from a source the tool does not know
  (not crates.io exactly, not git) refuses the whole SBOM rather than being left out, and so does a sourceless crate
  that is not THE member of that name (the one sourceless package so named, at the version its Cargo.toml or
  [workspace.package] gives, review 22: a path dependency outside the workspace can share a member's name) (a vendored crate that is not a workspace member would otherwise pass as first-party).

The app has no npm dependencies (package.json lists none) and the Swift app links Apple frameworks only, so that is
all the third-party code in the bundle.

## Why derived, not generated at build time
Any served release's SBOM can be rebuilt later from its signed manifest, on a machine that has (review 30 named
these): macOS with the Swift compiler, cargo with every crate of the relay's lock already in CARGO_HOME (Cargo runs
offline; a cold cache refuses, with a hint to run `cargo fetch --locked` first), git checkouts of both repos holding
the two commits, and the release's tmux bundle. The manifest is signed, so
the inputs are the ones the release vouched for. With the same generator, the same release always gives a
byte-identical file (the serial
number is derived from the format, the generator's own source hash and the tarball sha). LIMIT (review 5): the tmux bundle is served under one unversioned name, so
an older release's SBOM can be rebuilt only while the bundle it shipped is still the one served (or kept); once tmux
is rebuilt, the old release refuses on the hash, the safe direction. Publishing the SBOM at the cut (below) is the
real fix.

## Checked
- **Real release, 0.7.59 (served manifest and the served tmux bundle, whose sha256 equals the signed tmux_sha256):**
  236 components:
  - node 24.19.0, the installer (setup, under its signed hash), the tmux bundle, tmux 3.5a, libevent 2.1.12-stable, ncurses 6.5, utf8proc 2.9.0, the connector;
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
  checks the macOS build graph; the SBOM says so in its own metadata (a kosmos:cargo-closure property), not only in
  the source.
- **`tools.sbom-o05.test.js`:** 53 arms. The command line is run END TO END (review 10): a copy of the tool in a temp
  folder, next to a stand-in engine/manifest-verify.js that pins a test key, signs and builds, and the file it writes
  must equal build()'s output byte for byte. Every rule added in reviews 1 to 35, apart from the time limits named below, as measured in my own mutant runs, has a mutant that fails an arm, run at
  the time of the change (the first version, then rounds with a rule in order; a round that added no rule has no entry: four, eight, six, eleven, six, seven,
  nine, eleven, nine, four, eleven, eight, three, four, seven, six, five, three, five, four, five, five, six, four, nine, six, six, eight, seven, one, two and eight); the mutants of code later removed (the script's variable and url parsing, the hand-written Swift readers) were
  retired with it. Every
  field the SBOM vouches for has an assertion (review 11: the release hash, node's purl, cpe and download, each
  part's type, purl and cpe, the ncurses cpe). Equivalent survivors: review 4's whitespace class after the line
  split; the tmux-part dependency sort (the parts come out in the code's fixed order); review 10's signature length guard (crypto.verify refuses other lengths) and edge de-duplication.
- **The Mac app's imports are read by the Swift compiler** (decided after review 17). Reviews 15 to 17 each found a way
  past a hand-written reading of Swift (an access level, a raw string or regex literal that loses a quote, a comment
  before an import), the same pattern as the shell script; Swift really compiles each one. So the tool now asks
  `xcrun swiftc -frontend -emit-imported-modules -target arm64-apple-macos<floor>` (the floor read from
  tools/macos-floor at the app commit, as the bundle build compiles) for the modules native-app/main.swift imports, and
  every one must be an Apple framework (an allowlist). Review 18: without the target, an `#if arch(arm64)` import
  would be skipped on an Intel Mac; the command-line arm's stand-in xcrun records its arguments, so a missing target
  fails there on any machine. Measured: the compiler lists Evil, Sparkle and Kingfisher from every shape the
  hand-written readers missed, and exactly Cocoa, WebKit, Network, ApplicationServices, UserNotifications, Speech
  and AVFoundation from the real 0.7.59 file. Where no Swift compiler is installed the tool refuses with that reason
  (the release Macs have one). Tests: the fixture arms pass a simple stand-in reader, the command-line arm puts a
  stand-in xcrun on its PATH, and one arm runs the real compiler on the attack shapes and the real main.swift; on a
  machine without Swift that arm skips (measured: 34 pass, 1 skipped, before review 19 added two arms) and the rest still run.
  LIMIT (review 16): the shipped app/bin/kosmos-app is not tied to that source; the manifest's native_app hash and its
  files entry are taken from the same file, so they agree by construction.
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
  sixth time. What remains is a BEST-EFFORT cross-check, not exact (review 25 found a quoted "fetch" call and a
  lower-case zlib_url= it does not see; neither changes what the SBOM lists, which never comes from the script):
  every non-comment line that calls fetch must be one call in the one known shape,
  a *_URL= line nothing fetches refuses, a library fetched twice refuses, and every fetched name must be named by the
  bundle. WHAT SHIPS is decided by the signed manifest and the bundle (its signed hash, its VERSION, its lib/, plain
  files only, the binary's own version line), never by the script.
- **The bundle holds plain files and folders only** (review 8): a symlink or hard link refuses (both have an arm),
  a path may appear once (review 15), and an entry name with a control character or an escape refuses (review 20:
  bsdtar lists a newline in a name as a literal \n).
- **The binary's own version line** (`tmux: tmux 3.5a`) must equal the source it was built from (`tmux-src`), and
  (reviews 14 and 19) each version the VERSION file names must be in the bytes of EVERY binary or library of it
  (3.5a in bin/tmux, 2.1.12-stable in libevent, 6.5 in ncurses, 2.9.0 in utf8proc, all true for 0.7.59): a stale or
  edited VERSION refuses. This is a string-presence check, not a proof of the version.
- **The manifest's format is pinned** (reviews 14 and 16): format 1 only, and a key this SBOM does not know refuses, at
  the top level and inside app, node, connector, native_app and built,
  so a future manifest that signs a new shipped part cannot produce an SBOM without it. The release and node versions
  must be plain x.y.z. The SBOM names its generator (metadata.tools); the serial includes its format and a hash of the generator's own
  source, so a changed generator never reuses a document id (an arm builds from a one-line-different copy). The tmux bundle is a file component (no version), so a
  scanner sees tmux once, as its part.
- **The connector and node are tied to shipped files:** the manifest must ship app/bin/kosmos-tunnel with the
  connector's signed sha256, and runtime/bin/node. Commits must be full shas, and the manifest must say `dirty: false`.
- **The manifest's signature is verified** under the pinned keys of the checkout the TOOL runs from (its own ../../engine/manifest-verify.js, not --repo's) before
  anything is read from it. The real 0.7.59 manifest and its served .sig verify; the same manifest with its version
  changed refuses. Only the real release key is untested (it signs nothing in a test): the command line's success
  path runs end to end under a test key (see the tests bullet), and the CLI arm checks it refuses an unsigned manifest.
- **The bundle allowlist:** every file must be the VERSION file, a notice or licence, bin/tmux, or a dylib of a library
  the VERSION names. The real 0.7.59 bundle passes it; nine other shapes (a digit or a + in a dylib name, a
  subdirectory, libexec/, a bin/ helper, a .so, a .a, terminfo data) each refuse.
- **Every refusal names what it could not read,** so a new build-script shape fails loudly at SBOM time instead of
  going missing (review 2: the fetch-line approach is only as good as its refusal on a line it cannot parse).
- **Full-suite-only guards:** every-test-runs, all-node-tests-considered, engine.reachable, #1732, #1777 and the mktemp
  lint pass.

## Not covered, by design
- (Review 35.) The app commit's files are read by exact path, with no case-collision check across that commit (the
  relay's tree has one). A second spelling of native-app/main.swift would not change what the SBOM reads; whether
  a build machine's checkout picks the other one is inside the review-16 LIMIT (the binary is not tied to its source).
- (Review 34, stated rather than built.) The Swift compiler runs with the shell's environment, so DEVELOPER_DIR,
  TOOLCHAINS, SDKROOT or SWIFT_* can choose which Xcode toolchain reads the imports (scrubbing them would break a
  machine that needs DEVELOPER_DIR). The app and relay commits are checked to be 40-hex names that git reads, not
  that the object is a commit; the manifest that names them is signed. The tmux binary's linked libraries (otool -L)
  are not checked: the real bundle links only its own lib/ and /usr/lib, and a non-system library outside lib/ would
  go unlisted.
- DELIBERATE, so a future refusal is not read as a bug: a relay commit with a rust-toolchain(.toml), a .cargo folder,
  a symlink or a non-ASCII path anywhere refuses (reviews 27 and 28). If the relay adopts a toolchain file (for
  example to record `rustc -V`), this tool must learn to read it safely before it can vouch for that release.
- The C and assembly that crates such as `ring` and `aws-lc-sys` bundle are identified only by their crate's
  name and version, not as components of their own.
- (Was a gap, reviews 24 to 27; four hand-written readers of the relay's Cargo files were beaten in four rounds, so
  CARGO decides.) The connector is built WITHOUT `--locked` (relay tools/build-tunnel-release.sh; a relay change adds
  it), so a Cargo.toml that disagrees with the Cargo.lock would make Cargo re-resolve the build while the lock, and
  so the SBOM, names other crates. `cargo metadata --locked --offline` must succeed on the connector commit's tree,
  and the workspace members and their binaries are the ones it reports (review 27: a [workspace] inside a TOML
  string fooled the hand-written member reader into calling a non-member first-party). Measured with real Cargo on
  a test workspace: a path dependency outside the workspace (also with a quoted key and a triple-quoted path), a
  registry dependency missing from the lock, a quoted-key [patch], an export-ignore attribute, and a smudge filter
  in the checkout that would rewrite a bad toml to a good one, all refuse; the control passes and its members are
  Cargo's. On the real 0.7.59 commit it passes, and the SBOM is byte-identical to the previous round's.
- (Was a gap, review 31.) "Cargo decides" held for the members, NOT for the crate list: `--locked` compares the
  lock's meaning, so a lock Cargo accepts could read differently to the line reader (measured on the real 0.7.59
  relay commit: a `[[package]] # x` header hid itoa 1.0.18 from the reader and a fake itoa 1.0.99 inside a
  [metadata] string took its place; Cargo passed and the SBOM listed the fake). Now the lock AS READ must equal
  Cargo's own resolve graph from `cargo metadata`, package for package (name, version, source) and edge for edge,
  and the reader is strict: only exact `[[package]]` and `[[patch.unused]]` headers, nothing else at top level but
  comments and the format version. The real 0.7.59 lock reads exactly as Cargo resolves it. The --out partial file is
  removed and created exclusively (review 31: a planted link there was followed); the exclusive flag alone is an
  equivalent survivor behind the removal, and removing both fails an arm.
- **The tree Cargo reads** is written by the tool itself, blob by blob from `git cat-file --batch` (review 26: no
  filter, attribute, eol or lfs setting can change a byte), and BEFORE anything is written or Cargo runs, every path
  in the commit is checked (review 27 wrote a file OUTSIDE the tree through a committed symlink and a name a Mac
  folds to the same one, `s` and U+017F, and ran a program through a committed .cargo/config.toml's build.rustc):
  plain files only (no symlink, no submodule); printable ASCII names only, so case is the only folding a Mac does
  and it is checked across the whole commit; no .cargo anywhere, in any case; no Cargo.toml or Cargo.lock in another
  case; files created exclusively. Each is a real-git test arm, and with the .cargo refusal removed, the committed
  program really ran. Cargo gets an ALLOWLISTED environment (review 35: a __CARGO_* variable the earlier denylist missed let a stable Cargo accept a commit's unstable features): PATH, HOME, TMPDIR, CARGO_HOME and RUSTUP_HOME if set, and RUSTUP_AUTO_INSTALL=0; the end-to-end arm sets a __CARGO override and other variables and fails if any reaches Cargo. The real relay commit has
  1191 paths, no symlink, no non-ASCII name, no .cargo.
  Review 28: no rust-toolchain or rust-toolchain.toml anywhere, in any case (rustup reads one in the tree Cargo runs
  in, then downloads and runs that toolchain; measured: it reached for a download), and rustup is told not to
  install (RUSTUP_AUTO_INSTALL=0) with none of this shell's RUSTUP_* but RUSTUP_HOME; no .git part (git will not
  add one to the index, but plumbing can commit one, review 29; it has an arm). Every git call, and Cargo, run with none of this shell's GIT_*
  settings and with GIT_NO_REPLACE_OBJECTS=1 (measured: with a `git replace` ref in the checkout, git show of a
  signed commit returned another commit's file). Each git, cargo and xcrun call has a time limit.
  Review 33: Cargo runs with its working folder at / (the manifest path is absolute), because Cargo and rustup read
  config and toolchain files in every folder above their working folder, and one above the temp folder could name
  the rustc Cargo runs (measured: it tried to execute one). An arm plants such a config above the temp folder AND in the
  caller's working folder (review 34: the first version of the arm could not fail); the program never runs. tar is /usr/bin/tar with a time limit, and given the signed hash the bundle refuses before tar
  reads it.
  LIMIT: Cargo still reads config in CARGO_HOME (and in /.cargo), which is this machine's, and such config can name
  the rustc or a wrapper that Cargo runs.
  LIMIT (review 32): the crate CHECKSUMS the SBOM lists are held by Cargo, not by this tool: `cargo metadata --locked
  --offline` refuses a checksum that differs from the one in CARGO_HOME's cached index (an arm flips one character
  and Cargo refuses), but the comparison against Cargo's graph covers names, versions, sources and edges only. So a
  checksum is as trustworthy as this machine's Cargo cache.
  Equivalent survivors, recorded: the exclusive-create flag (the path checks already make every path unique), the
  per-blob newline check and the end-of-output check (git answers exactly one record per sha asked, so a
  misaligned read fails the next entry's sha check), and the
  two-members-one-name refusal (Cargo itself refuses that workspace), the members-count agreement (valid
  cargo metadata describes every workspace member it names). UNTESTED, stated rather than claimed: the time limits
  on git, cargo and xcrun have no arm (a stuck tool would need an injectable limit to simulate); nor has the cold-cache hint (measured by hand with an empty CARGO_HOME: it refuses and names `cargo fetch --locked`).
- (Review 25.) A CPE escapes reserved characters in a version (a '+').
- (Was a gap, review 23.) Every file read from git must be a plain file there (mode 100644 or 100755, read with git
  ls-tree first): git show of a symlink returns its target PATH as text, so a symlinked main.swift passed as importing
  nothing. Any `.cargo` entry (a folder, a file or a symlink) anywhere in the commit, in any case (review 27) refuses. The
  installer is listed as a `setup` file component under its signed hash, instead of being signed and dropped.
- The build machine's own ~/.cargo/config and CARGO_* settings, which can point a crate at other code. A .cargo/config
  in the relay itself, anywhere in the commit, in any case (review 27), refuses (review 21); lockfile values must be plain quoted strings
  and every package must have a name and version (a literal string or a trailing comment dropped the version).
- (Was a limit; now a refusal, reviews 19 to 21.) Any `#if` anywhere in main.swift (Swift accepts one after a
  comment or code on the same line) refuses: several conditions (canImport,
  swift, compiler, hasFeature, hasAttribute) read as the machine running this, not the build, and a list of them kept
  missing one. The real file has no #if.
- macOS's own libraries (libSystem, libresolv, the Apple frameworks) are not listed: they are the operating system.
- After the release key is rotated, a manifest signed only by the retired key refuses here (the checkout's KEYS are
  used), so an old release's SBOM is rebuilt from a checkout that still pins its key, or not at all.
- The second native binary, app/Kosmos.app/Contents/MacOS/Kosmos (a re-signed copy of kosmos-app, so a different
  hash), is accepted by name; and a static C library brought into the Mac app by a bridging header or a linker flag,
  not an import, would not be seen.
- A vendored third-party crate made a member of the relay workspace passes as first-party.
- Out of scope, and not listed: what Kosmos downloads later, each pinned by its own hash in engine/ (review 20): the
  provider tools (Claude Code, Codex, Gemini CLI, Grok and so on) when a person connects one, and the agent browser
  (Playwright MCP and Chrome headless shell) the first time an agent uses it. The installer itself installs none.
- A library linked statically into tmux with neither a VERSION line nor a licence file. The bundle's licenses/ is a
  record of what it was built from (one <name>-<version>.txt per library), and review 15 made it checked: each licence
  must be a part VERSION names, at its version, and each part must have one. The build script writes both today.
- The VERSION-in-the-binary check is string presence: a prefix of the real version (3.5 for 3.5a) would also pass.
- The release tarball is not read: its hash comes from the signed manifest, whose file list is exhaustive by
  construction (the bundle build lists every file of the same stage it packs, and refuses anything that is not a plain
  file; on an update the installed copy also checks every file against it). The shipped runtime/bin/node is not tied to the nodejs.org hash here; the bundle build checks
  it against nodejs.org's SHASUMS256 before packing.
- Of the shipped files, only app/package.json is tied by hash to an independent source (git). app/bin/kosmos-tunnel
  and app/bin/kosmos-app agree with their manifest records, which the bundle build takes from the same files.
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
under-lists. A reviewer may prefer the exact macOS build graph (`cargo tree --target aarch64-apple-darwin -e normal,build`, 189 crates; `-e normal` alone drops build dependencies),
and the tool now runs Cargo anyway (reviews 25 to 27); switching the crate list to that graph is a follow-up, not this
change.
