---
pre_challenge: true
method: challenge-loop
branch: previewsweep-5254
diff_hash: c582f37bd1232d178f14e6d2a8b8be2fc5bae8045db445862bcf2db98943fa00
validation: passed (D3, stacked on #5119 ddef70dae: focused 1092/1092, 26 related files + every file-scanning guard); a full suite before the after-Monday merge
subdir_audit: passed
timestamp: 2026-10-04T14:43:27Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (opus, fresh blind reviewer)
**Converged:** Yes (1 BLOCKER fixed; 1 WARNING documented; NITs fixed or decided)
**Fixed:** 1 BLOCKER + 3 NITs | **Deferred:** 0 | **Asked (awaiting user):** 0

#5254, stacked on #5119: a cached PDF first page is swept when its PDF, project or agent is gone.
NOTE: diff_hash is over origin/filespreview-4997...HEAD (this PR's base), not origin/main.

## Round 1 (opus): 1 BLOCKER, 1 WARNING, 4 NITs
- [BLOCKER] a sweep during a first render took the folder (no record yet), so a good PDF failed to preview: FIXED.
  A folder with an r-* render inside is skipped; an unrecorded folder is left until 10 minutes old. Test: the renderer
  itself runs a sweep (as the hourly timer could) and the page is still drawn; mutant (guard removed) turns it red.
- [WARNING] lstatSync per folder could stall on a hung network drive: documented in the code as a known cost.
- [NIT] a mid-render sweep then noteSource recreated a record-only folder: FIXED (only when the page exists).
- [NIT] owner id raw vs removed names cleaned: FIXED (compared through create.cleanName) + test.
- [NIT] no-record test lacked a kept control: added (a young unrecorded folder is kept).
- [NIT] agent removal waits for the hourly sweep: decided (plan).
- Checked clean: nothing outside the cache can be deleted (directory entries only, links skipped, rec.target only
  lstat'ed); 0600 record via tmp+rename; failures fail toward keeping; a sweep cannot break a good preview.

## Weakest premise
Up to an hour on disk after an agent's removal or a PDF's deletion; a page is never SERVED for a gone file.
