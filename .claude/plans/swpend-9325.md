# swpend-9325: a delete-pending file at a temp name refuses the save on Windows (kosmos#9325)

## Finished looks like
engine/securewrite.js never reaches its in-place fallback because a file was left delete-pending at a guessable temp
name: an EPERM on the `wx` create of a fresh temp name whose name is still present (lstat answers) counts as a plant,
like EEXIST since #9307. An ordinary EPERM (no name there) still falls back.

## Measured first (GitHub's Windows runner, build 26100, Node v26.13.1; never-merged branch delpend-9325-never-merge)
- Node unlinkSync of a held file: POSIX semantics, the name goes at once, `wx` creates (no plant route).
- FileOptions.DeleteOnClose held: the name lists, `wx` fails EEXIST (already refused by #9307).
- Classic delete disposition held (CreateFileW GENERIC_READ|DELETE, SetFileInformationByHandle FileDispositionInfo):
  the name lists, lstat answers, `wx` fails EPERM; after the holder exits the name is gone. Runs 46186480532 and
  46186764874; card comments 7245318882 and 7245359468.

## The change
In the `wx` create's catch: EPERM plus a successful lstat of the temp name is a plant (ERR_KOSMOS_TEMP_SWAPPED,
planted). The doc paragraph that carded this as open now describes it as closed.
Rejected: counting every EPERM (it is the ordinary reason a Windows save reaches the fallback).

## Test
securewrite.test.js #9325: an EPERM stub with a file at the name refuses (config unchanged, no in-place open, the file
kept); CONTROL: an EPERM with no name still falls back and writes. Fails on main ("a delete-pending name did not
refuse"). The EPERM-based tests moved by #9307 inject EPERM with no name, so they still reach the fallback.

## Weakest premise
That nothing honest leaves a name at a fresh temp name while its create fails EPERM: the four honest EEXIST routes of
#9307 apply, and our own just-made temp cannot be held by a scanner before our own create returns. Not measured: older
Windows builds and non-NTFS volumes.
