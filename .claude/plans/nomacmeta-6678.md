# nomacmeta-6678: the Mac tarballs carry no macOS metadata from the build Mac (kosmos#6678)

## Problem (measured on this Mac, bsdtar 3.5.3 / libarchive 3.7.4, 2026-10-20)
A plain `tar -czf` of a file with one extended attribute writes it THREE ways: an AppleDouble `app/._f` entry, and
two pax headers (`LIBARCHIVE.xattr.*`, `SCHILY.xattr.*`). `tar -tzf` of that tarball lists NO `._` entry: bsdtar
folds it back into its file when listing, so a listing-based check cannot see it.

| packed with | `._` entry | xattr headers |
|---|---|---|
| plain | yes | yes |
| COPYFILE_DISABLE=1 | no | yes |
| --no-mac-metadata | no | yes |
| --no-xattrs | yes | no |
| all three | no | no |

## Change
- `tools/build-kosmos-bundle.sh` and `tools/build-tmux-bundle.sh` pack with `COPYFILE_DISABLE=1 ... --no-mac-metadata
  --no-xattrs --no-fflags` (both scripts are Mac-only, so the bsdtar-only flags are safe). Review 1 measured that
  file flags (`chflags hidden`) survive the first three as `SCHILY.fflags`, and bsdtar restores them on extract.
- `tools/lib/tar-macmeta-gate.sh` refuses a tarball holding a `._` entry, an xattr header or an fflags header. It reads
  raw entries with /usr/bin/perl (review 1: python3 is the developer-tools shim, and the tmux build dropped it).
  Both builds call it after the owner gate (#6562), the same shape.
- Measured on the REAL served 0.7.60 tarball (sha256 matches its .sha256): refused in 0.26 s, naming
  `app/._Kosmos.app` and `com.apple.macl`, none of which `tar -t` shows.
- `tools/test-tar-macmeta-gate-6678.sh`, in `test:shell`: a control (the bundles' packing passes), each partial flag
  shown leaving its kind in and caught, a built tarball with both kinds (runs on any OS), junk/truncated/empty/missing
  refused, and both build scripts pinned. Shown red against main's tmux script.

## Known limit
An entry over 8 GiB (a base-256 or pax `size` override) is misread, and the next header's checksum then refuses the
tarball: the gate fails closed, so a build with such a file would stop at the gate. The bundles are tens of MB.

## Rejected
- Only COPYFILE_DISABLE=1, which the card names first: it leaves the xattr pax headers in (measured above).
- A `tar -t`-based gate like the owner gate: it cannot see the `._` entry, and `-t` refuses --no-mac-metadata.
- python3 for the reader (review 1): a developer-tools dependency the tmux build had removed.

## Weakest premise
That stripping extended attributes cannot break a signature in the bundle. Now MEASURED for what ships today: every
pax key in the real served 0.7.60 tarball, listed in full, is `com.apple.macl` (a privacy-permission record on the
app folder, twice: LIBARCHIVE and SCHILY forms) plus one `mtime`, and there is one `._Kosmos.app`. No
`com.apple.cs.*` key exists, so no shipped file keeps its signature in xattrs; signatures are embedded (Mach-O) or in
`Contents/_CodeSignature`. What would change it: the bundle starting to sign a non-Mach-O file (a script), whose
signature codesign keeps in xattrs. The gate would then still pass (it strips, it does not check signatures), so a
step-4b install from the bundle is where that would show.
