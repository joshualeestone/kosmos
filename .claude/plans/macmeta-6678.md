# macmeta-6678: the Mac tarballs carry none of the build Mac's own file metadata

Card: kosmos#6678 (from the #1760 shipped-artifact pass). Owner: Baron Draxum (release lane). Target: 0.7.61.

## What was wrong, measured on the served bytes

`https://installkosmos.com/dist/kosmos-arm64.tar.gz` (0.7.60, its sha256 matching the published one) holds 379
entries. Two of them carry the build Mac's own metadata:

- `app/._Kosmos.app`, an AppleDouble entry (the file macOS writes to hold what tar cannot store);
- a `com.apple.macl` extended attribute on `app/Kosmos.app` (two pax records), the build Mac's own privacy record.

Neither is a code signature: the app's seal and every binary's signature live inside the files. No other entry has
an extended attribute. So both can go.

## The change

- `tools/build-kosmos-bundle.sh` and `tools/build-tmux-bundle.sh` pack with
  `COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs`, naming bsdtar explicitly (both builders are
  macOS-only, so bsdtar's flags are always available, and a GNU tar earlier on PATH cannot take the line).
- `tools/lib/tar-metadata-gate.sh` (new): refuses a tarball with an AppleDouble entry or an extended-attribute pax
  record, and refuses rather than passes one it cannot read in full. Both builders call it after the owner gate.
- `tools/test-tar-metadata-gate-6678.sh` (new, in `test:shell`), and the owner gate's test now pins the new pack
  lines.

## Decisions, and what was rejected

- **The gate reads the tar headers itself (perl).** macOS tar cannot be asked: bsdtar folds an AppleDouble entry into
  the next entry when it reads, so `tar -t` never lists one (measured: the 0.7.60 listing shows none, its headers hold
  one), and it refuses `--no-mac-metadata` in list mode. A first version listed with `tar -t` and passed the 0.7.60
  tarball's AppleDouble entry; the test caught it. Rejected python: `/usr/bin/python3` exits 69 on a build Mac without
  the Xcode license. `/usr/bin/perl` is a real binary on every Mac.
- **Refuse, not strip after the fact.** A gate that edits the tarball would change the bytes after signing-adjacent
  checks; refusing keeps the pack line the only place the bytes are made.
- **Both tarballs.** The tmux bundle is built the same way, so it gets the same line and gate.

## Weakest premise

That nothing the Mac needs at install time is held in an extended attribute. Checked for the 0.7.60 tarball (only
`com.apple.macl`, a per-machine record), not for every future file. If a later file needs one, the build will refuse
loudly, which is the safe direction.

## Tests

- `bash tools/test-tar-metadata-gate-6678.sh`: 12 checks. The control packs a folder that HAS an extended attribute
  the way the bundles pack, and passes. Then: plain packing refused; an AppleDouble entry refused and named (in a
  folder, at the top level, and behind a long pax path); a name with `._` inside it not a hit; a half tarball, junk,
  an empty archive and a missing file refused; both builders pack once with the flags and call the gate.
- Mutants: the AppleDouble detector removed fails 3 checks; the extended-attribute detector removed fails 1.
- `bash tools/test-tar-owner-gate-6562.sh`: passes with the new pack lines.
- The gate run on the served 0.7.60 tarball refuses it, naming `app/._Kosmos.app` and the 2 records.

## Not covered

- A real bundle build here: the cut builds it. The first cut after merge (0.7.61) is the end-to-end check, and its
  served tarball should be run through the gate.
- Windows: its zip is built elsewhere and carries no macOS metadata.
