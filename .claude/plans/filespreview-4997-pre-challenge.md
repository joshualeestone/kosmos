---
pre_challenge: true
method: challenge-loop
branch: filespreview-4997
diff_hash: ea4b5cf8529fe044aea248b87437ac655fe3f52d4eac55f11e4b363a57b91743
validation: passed (Mortals, full suite, 2026-10-03 01:18 CDT, hash ea4b5cf8529f, recorded)
subdir_audit: passed
timestamp: 2026-10-03T07:07:25Z
iterations: 17
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 17: reviews 1 to 14 before the rebase onto main (after Mona's #4999 merged), 15 and 16 after it, and 17 on the Windows fix the first full run forced.
**Converged:** Yes. Review 14: 0 B, 0 W, 0 C. Post-rebase 16: 0 B, 0 W, NITs only. Review 17 (opus, the #1732 delta): 0 B, 1 W, fixed and measured.
**Fixed:** every BLOCKER and WARNING except those written into the plan as kept | **Asked (awaiting user):** 0

**Validation, stated plainly:**
- The first full run (Mortals, f86c35f56, 11:18) FAILED two repo-wide Windows audits (#1732: `engine/windows-coupling-audit-1732.test.js`, `engine/win32-separator-guard.test.js`) on `engine/filepreview.js`. My focused runs never selected those audits, because they scan the whole tree and a symbol grep cannot find them. Fixed in 9c8f6c844 and 96cfe20e2 (review 17 below).
- Then the Agent1s full run of 96cfe20e2 went red ONLY on the browser-check surface gate (#2518), false hits (`msg` was a local variable; `pj-docs` read-only selectors): excused per check by trailers in 93f612d0c, gate measured green with them and red without. A Mortals run of 93f612d0c went red ONLY on the #3011 leak guard, from Mortals' own live agent (liukang's plist, born Sep 11, rewritten 22:11 when Josh switched it; this branch has no launchd code): filed and fixed as #5092.
- Main then conflicted on two bookkeeping files (README rows, the reason-grep count): merged main in (cee365fcd), count 235 measured (234 fails).
- **The full suite PASSED for this exact diff on Mortals, 2026-10-03 01:18 CDT, hash ea4b5cf8529f, recorded.**
- Rule C on the merged tree with today's main (+131, 7d8151a16, scratch, removed): 520 focused + meta files, 7467 tests, 0 fail.
- Browser check `render-files-preview-4997` FINAL on 96cfe20e2, 11:55: ALL PASSED, 90 checks = 45 chromium + 45 webkit, 0 fail, 0 skip. CONTROL run (preview disabled) failed exactly F1+F2 x 4 lists x 2 engines = 16.
- Rule C after main moved (merged tree 70484ee38, 10:39): 111 focused files, 2682 tests, 2680 pass, 0 fail.

### Per-iteration breakdown
Reviews 1 to 14 are in the plan's review log (`.claude/plans/filespreview-4997-2026-10-02.md`), each with its fix. Headlines: review 1's BLOCKER (the routes served files the list hides) fixed; measured races (a file swapped for a link between the walk and the open) fixed with the resolve-time identity check (review 3) and the read's own fstat identity check (review 11); Windows ':' names refused (review 6).

#### Review 15 (opus, after the rebase) - 0 B, 0 W
- NITs fixed in f86c35f56.

#### Review 16 (sonnet) - 0 B, 0 W, NITs only => CONVERGED
- Recorded here rather than in the plan, so the validated hash did not move.

#### Review 17 (opus, the #1732 Windows fix in 9c8f6c844) - 0 B, 1 W, 2 N
- [WARNING] the new O_NOFOLLOW-off arm stayed green with the test seam broken (on macOS the kernel flag still refused, with a different sentence) --> FIXED 96cfe20e2: the link arm and review 11's rename arm assert the identity check's own refusal ('that file changed while it was being read'); measured red with the seam made a no-op, and red with the identity check removed.
- [NIT] on win32 the inode is the NTFS file id compared as a JS number --> recorded in the inventory row's reason.
- [NIT] O_NONBLOCK row wording --> FIXED.
- Verified by the reviewer: both inventory rows true; the stamp separator change touches no other reader; the seam resets in `finally`; 101 list-and-read files 3236 pass, 0 fail.
