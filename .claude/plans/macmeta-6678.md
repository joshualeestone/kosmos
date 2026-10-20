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
  `COPYFILE_DISABLE=1 /usr/bin/tar --no-mac-metadata --no-xattrs --no-fflags`, naming bsdtar explicitly (both builders are
  macOS-only, so bsdtar's flags are always available, and a GNU tar earlier on PATH cannot take the line).
- `tools/lib/tar-metadata-gate.sh` (new), two layers: a header reader that refuses an AppleDouble entry or a
  metadata record (and anything it cannot read in full), then an extraction check that unpacks the tarball the way
  install/setup.sh does and refuses anything that comes out with an attribute, a file flag or a `._` name. Both builders call it after the owner gate.
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
- **Review 5 (opus), and the decision it forced:** four more hand-forged shapes where bsdtar reads a `._` entry and
  the header reader does not: a type-0 entry named like a folder with a size, a NUL inside a GNU long name, a NUL
  inside a pax path, and `GNU.sparse.name`. Every round had found another such shape, because the header reader is a
  second implementation of libarchive's parser. Rather than chase them one corner at a time, the source of truth is
  now what bsdtar itself EXTRACTS: after the header layer, the gate unpacks the tarball as install/setup.sh does
  (`/usr/bin/tar -xzf ... --no-same-owner`, macOS default, which folds an AppleDouble entry into the file it
  describes) into a temporary folder and refuses anything that comes out with an extended attribute (read with
  `xattr -s`, so a symlink is never followed), a file flag, or a `._` name. Measured: the served 0.7.60 tarball
  unpacks with `com.apple.macl` on `app/Kosmos.app` and is refused by this layer alone; the 0.7.60 tree re-packed the
  new way unpacks clean. A forged `._` entry that changes nothing when extracted is inert bytes; one that changes
  anything is refused here whatever shape hid it. Arm: bsdtar --mac-metadata makes REAL AppleDouble bytes, re-emitted
  under a GNU long name with a NUL in it; the header layer passes it and the gate refuses it naming the attribute it
  planted. The four shapes are therefore NOT patched in the header reader (stated, on purpose). Also: an ACL arm; a
  symlink-not-followed arm; a clean-extraction control. Mutants: the extraction call removed, `xattr -s` without
  `-s`, and the ACL refusal removed each fail their own arm.
- **Review 6 (sonnet):** the extraction layer is now always cleaned up. A 0555 folder in the tarball made rm fail and
  left about 160 MB behind while the gate passed, so permissions are restored before removal, an interrupt trap
  covers the unpack, and a folder that will not go is a refusal. Its scans count: a find or xattr that fails is a
  refusal, not a clean answer, and `xattr -s` must read a probe attribute before an empty answer means clean. MEASURED:
  an install-style extraction does not restore a stored file flag (only `tar --fflags` does), so the header layer is
  what refuses a flag record and the extraction layer's flag scan is a backstop; an arm records that behaviour and
  goes red if bsdtar ever restores flags on a plain `-x`, and the scan's own mutant is equivalent today (stated).
  Arms: the read-only folder (passes, leaves nothing; red with the permission restore removed), and the
  flag-restore behaviour.
- **Review 7 (opus):** an AppleDouble entry folded on extraction restores an ACL as well as attributes (measured),
  which the extraction layer did not look at, so the claim "whatever shape hid it" was false for ACLs. It now scans
  ACLs (`ls -lde`) on everything unpacked, and strips ACLs (`chmod -RN`) before every removal, since a deny-delete ACL
  also stopped rm. An interrupt during the unpack is passed on after the cleanup (it was swallowed), and the caller's
  own INT and TERM traps are restored. Arms: the forged NUL-long-name shape carrying a deny-delete ACL (refused naming
  the ACL, nothing left behind; red with the ACL scan or `chmod -RN` removed), and a hand-made 0000 folder (scanned,
  passes, nothing left; red with the pre-scan permission restore removed). UNTESTED BACKSTOPS, stated: the `xattr -s`
  probe failing, a scan's own failure (`|| scan=1`), and the leftover-folder check cannot be reached by any tarball on
  this Mac (with permissions and ACLs stripped, removal always succeeds), so their mutants are equivalent here.
- **Refuse, not strip after the fact.** A gate that edits the tarball would change the bytes after signing-adjacent
  checks; refusing keeps the pack line the only place the bytes are made.
- **Both tarballs.** The tmux bundle is built the same way, so it gets the same line and gate.

## Weakest premise

That bsdtar on the person's Mac extracts exactly as /usr/bin/tar on the build Mac does (the extraction layer
stands in for the install). Both are the system bsdtar; a different macOS version could fold metadata differently.


That nothing the Mac needs at install time is held in an extended attribute. Checked for the 0.7.60 tarball (only
`com.apple.macl`, a per-machine record), not for every future file. If a later file needs one, the build will refuse
loudly, which is the safe direction.

## Tests

- `bash tools/test-tar-metadata-gate-6678.sh`: 47 checks. The control packs a folder that HAS an extended attribute
  the way the bundles pack, and passes. Then: plain packing refused; an AppleDouble entry refused and named (in a
  folder, at the top level, behind a long ustar-prefix path, behind a GNU long name, and behind a hand-made pax path
  record whose entry header says app/K, with a control that the same hand-made entry passes without it); a header
  whose checksum does not match refused; a name with `._` inside it not a hit; a half tarball, junk,
  an empty archive and a missing file refused; both builders pack once with the flags and call the gate.
- Mutants: the AppleDouble detector removed fails 3 checks; the extended-attribute detector removed fails 3 (the
  well-formed control, LIBARCHIVE alone, the global header); the pax-path reading removed fails 2; the GNU long-name
  reading and the checksum check each fail their own; the later rounds' guards are listed under each review below.
- `bash tools/test-tar-owner-gate-6562.sh`: passes with the new pack lines.
- The gate run on the served 0.7.60 tarball refuses it, naming `app/._Kosmos.app` and the 2 records.

## Not covered

- ACLs: bsdtar 3.5.3 stores none by default (measured by review 3). The header layer refuses an ACL pax record (a
  non-root `-x` does not restore one anyway), and the extraction layer refuses an ACL that a folded AppleDouble entry
  restores (review 7).
- A real bundle build here: the cut builds it. The first cut after merge (0.7.61) is the end-to-end check, and its
  served tarball should be run through the gate.
- No size or time limit on the extraction: the builders unpack their own output, which is not hostile (review 6,
  stated).
- Windows: its zip is built elsewhere and carries no macOS metadata.
