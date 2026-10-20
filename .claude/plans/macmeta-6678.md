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
- **Review 1 (opus) measured signing unaffected:** the served 0.7.60 tarball re-packed the new way extracts to an
  identical tree with no extended attributes; codesign --verify --deep --strict, stapler validate and spctl (Notarized
  Developer ID) all pass, and all four Mach-O files verify. It also found the reader skipped GNU long names (an
  AppleDouble entry there passed) and that the pax-path reading had no test; both are fixed and tested. The reader now
  checks every header's checksum and refuses a base-256 size (a file of 8 GiB or more).
- **Review 2 (sonnet):** a pax record of length 0 looped the reader for ever, and one that did not parse ended the
  record loop quietly, hiding an extended attribute after it. Every record must now be whole (its length at least
  its own header, within the body) and KEY=VALUE, and the body read to its end; anything else is refused. Each entry
  is checked under every name it could be extracted under (its pax path, its GNU long name, its header name), so a
  pax path followed by a long name is no longer lost; this also makes the "a pax path applies to the next entry
  only" rule unable to change a verdict, which is why no check tests it. Arms: length 0 (under a 20-second alarm, so
  a regression fails rather than hangs), a record that does not parse, one that is not KEY=VALUE, one longer than its
  body, and a pax path then a long name; each guard removed fails its own arm.
- **Review 3 (opus):** a pax `size` record moved where bsdtar reads the next entry while this reader kept the header
  size, so an attribute hid between them (my comment said the stream stayed in step either way; it did not). A pax
  size is now refused (the bundles never need one). File flags (`SCHILY.fflags`, from chflags) shipped too: both pack
  lines add `--no-fflags`, and the gate refuses file-flag and ACL records with the attributes. The reader reads to the
  end of the stream and refuses non-zero data after the end, so the verdict no longer depends on the caller's
  pipefail. The builders' order (pack, owner gate, metadata gate, .sha256) is checked. New arms: file flags, pax
  size, an attribute in the LIBARCHIVE form alone, an attribute in a global header, a tar cut mid-body and one with
  no end blocks (compressed whole, so gzip -t passes and the reader itself refuses), a base-256 size, zero padding
  after the end (passes) and trailing data (refused). Mutants: the size, file-flag, trailing-data, end-block,
  LIBARCHIVE, global-header and order guards each fail their own arm. Three are EQUIVALENT and stated, not tested:
  removing the short-header check, the short-body check or the base-256 refusal leaves each case refused by another
  guard (the checksum on a short or zero-sized next header, or the end rule), so no tarball tells them apart.
- **Review 4 (sonnet):** bsdtar reads no body for a link, device, folder or FIFO (types 1 to 6) whatever its size
  field says, while this reader skipped one, so a sized folder or symlink hid a `._` entry bsdtar extracts. A non-zero
  size on those types is refused, and so is any type byte outside the ones bsdtar reads. File bodies are now read in
  64 KiB chunks and dropped (only record bodies are kept), so memory no longer grows with the largest file. Arms: a
  sized folder and a sized symlink before a bodiless `._hidden` (both red on their mutant), an unknown type (red on
  its mutant), and a control that a real tarball with a symlink, a hard link and folders passes.
- **Refuse, not strip after the fact.** A gate that edits the tarball would change the bytes after signing-adjacent
  checks; refusing keeps the pack line the only place the bytes are made.
- **Both tarballs.** The tmux bundle is built the same way, so it gets the same line and gate.

## Weakest premise

That nothing the Mac needs at install time is held in an extended attribute. Checked for the 0.7.60 tarball (only
`com.apple.macl`, a per-machine record), not for every future file. If a later file needs one, the build will refuse
loudly, which is the safe direction.

## Tests

- `bash tools/test-tar-metadata-gate-6678.sh`: 38 checks. The control packs a folder that HAS an extended attribute
  the way the bundles pack, and passes. Then: plain packing refused; an AppleDouble entry refused and named (in a
  folder, at the top level, behind a long ustar-prefix path, behind a GNU long name, and behind a hand-made pax path
  record whose entry header says app/K, with a control that the same hand-made entry passes without it); a header
  whose checksum does not match refused; a name with `._` inside it not a hit; a half tarball, junk,
  an empty archive and a missing file refused; both builders pack once with the flags and call the gate.
- Mutants: the AppleDouble detector removed fails 3 checks; the extended-attribute detector removed fails 1; the GNU
  long-name reading, the pax-path reading and the checksum check each removed fail exactly their own check.
- `bash tools/test-tar-owner-gate-6562.sh`: passes with the new pack lines.
- The gate run on the served 0.7.60 tarball refuses it, naming `app/._Kosmos.app` and the 2 records.

## Not covered

- ACLs: bsdtar 3.5.3 stores none by default (measured by review 3); the gate refuses them anyway.
- A real bundle build here: the cut builds it. The first cut after merge (0.7.61) is the end-to-end check, and its
  served tarball should be run through the gate.
- Windows: its zip is built elsewhere and carries no macOS metadata.
