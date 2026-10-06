# #5424: on a case-sensitive disk the new-project preview names one folder and Kosmos makes another

**Branch:** `casefold-5424` · **Card:** kosmos#5424 (found by the #4919 Linux lane)

## The defect, reproduced on this Mac

`trueChildName` adopted the one case-insensitive match in the listing without asking whether the typed
name really opens it. A case-sensitive APFS image mounted in scratch reproduced it with main's code:
preview `Lease` (exists: true), makeFolder made `lease`, both now on disk. On this Mac's own
case-insensitive disk both say `Lease`, which is why no Mac run saw it.

## The fix

`trueChildName` returns an exact entry when the listing has one, and adopts another spelling only when a
stat of the typed name succeeds (a case-insensitive disk opening the same folder). Probe after the fix:
case-sensitive image: preview `lease`, exists false, made `lease`; this Mac's disk: `Lease` throughout.

The test now asks the disk before the act whether `lease` opens `Lease`, and requires the preview's
`exists` and the made folder's name to match that answer, instead of asserting `exists: true`, which is
true only on a case-insensitive disk.

## Decided, not missed

- No committed test mounts a case-sensitive image: hdiutil is Mac-only and a mount left behind by a killed
  run is worse than the gap. The Linux lane runs this test on a case-sensitive disk; that is the guard for
  the other arm, and it was red there before this change.
- On this Mac, removing the fix leaves the test green (the disk cannot show the bug); the Linux run is the
  mutation evidence.
