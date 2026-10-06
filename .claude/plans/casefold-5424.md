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

Two tests carried the case-insensitive assumption (`exists: true` for `lease` beside `Lease`): the engine test
in engine/projects.test.js and its route twin in server.projects.test.js (found by blind review 1). Both now ask
the disk before the act whether `lease` opens `Lease`, and require the preview's `exists` and the made
folder's name to match that answer.

## Decided, not missed

- No committed test mounts a case-sensitive image: hdiutil is Mac-only and a mount left behind by a killed
  run is worse than the gap. The Linux lane runs both tests on a case-sensitive disk; the engine test was
  red there before this change (card #5424, run 37531000100).
- On this Mac's own disk both tests pass with or without the fix. Mutation evidence, measured by hand: with
  TMPDIR on a case-sensitive APFS image, both tests fail against main's engine and pass with the fix.
- Not changed, and not new: a name stored in NFD (common on macOS) and typed in NFC opens the same folder,
  but the lower-case comparison does not match the two forms, so the typed spelling is kept. Preview and
  act still agree (both use the same stat), which is this card's property; normalising is its own change.
- Not changed here: three other tests in engine/projects.test.js (`"Lease" and "lease" are ONE project...`,
  `an adopted folder is stored under the spelling...`, `the same folder reached by two spellings of a MIDDLE
  segment...`) assume a case-insensitive disk by their own names and fail on a case-sensitive one (blind
  review 2, measured on the image). The #4919 Linux lane already skips them off case-insensitive disks with
  its `caseInsensitiveFS()` probe; adding a second skip here would duplicate that and collide when #4919
  merges. Weakest premise: that #4919 merges with those skips intact.
