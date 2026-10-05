---
pre_challenge: true
method: challenge-loop
branch: filespreview-4997
diff_hash: 31dd0aeedf074039e8db380b187beb2e5a16c4ddbb9dc4af2ae577f28780753f
validation: passed (full suite at c96f15077: 15261 tests 0 fail, status clean; FULL browser checks at c96f15077 failed ONLY render-agent-files-3614, stale against this PR and updated at 3b4521ed3/ead7046b6; the suite and FULL browser checks re-run after this proof)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-05T06:15:06Z
iterations: 11
converged: true
---

## [CHALLENGE-LOOP] Summary: the rebase onto main (2026-10-04 evening)

**Iterations:** 11 (iteration 11 reviewed the stale-check update after the full browser checks; iteration 10 is a blind opus review of the rebase onto main: 137 main commits, 0ef8b4094 -> cbe6e72fc).
**Converged:** Yes. Iteration 10 found no BLOCKER or WARNING.
**Conflict:** one, in browser-checks-reason-grep.test.js. Main replaced the hand-kept totals with per-check SITE_COUNTS lines; resolved to main's side plus `'render-files-preview-4997.js': [1, 1]`, measured by the file's own count test (sorted, and the measured-count test passes).

### Per-Iteration Breakdown
- [NIT] iteration 11 (sonnet, the render-agent-files-3614 update at 3b4521ed3): no assertion that Escape closed the preview before the Cmd-click --> FIXED ead7046b6
- [NIT] iteration 10: the check is launched by its own run_one line rather than a line in docs/browser-checks/gated.txt, a likely future conflict spot --> DEFERRED (not caused by the rebase; moving it changes the runner's wiring, out of scope for a rebase)

### Final Ledger
| # | Iter | Cat | File | Origin | Description | Status |
|---|---|---|---|---|---|---|
| 1 | 10 | N | tools/browser-checks.sh | BRANCH | run_one line, not gated.txt | DEFERRED |
| 2 | 11 | N | docs/browser-checks/render-agent-files-3614.js | SELF | no assertion that Escape closed the preview | FIXED |

Overlap (iteration 10): main's server.js hunks add no route and touch none of this PR's routes, refuseDownload, sendFileDownload or fileInFolder; of the web/index.html hunks only #5218 touches `.pj-doc`, its size only; engine/projects.js gained changedFileTimes, which calls none of this PR's functions; tools/browser-checks.sh's #5231 hunks are compatible.

## [CHALLENGE-LOOP] Summary: the rebase onto #5165 (2026-10-04)

The branch was squashed onto main after #5165 (0.7.22) and the merge was decided on PR #5119 (see the plan's rebase
section). This loop reviewed the merged diff from scratch.

**Iterations:** 9, alternating Opus and Sonnet. **Converged:** yes. Iteration 9 had only NITs.
**Total findings:** 21 actionable (0 BLOCKERs, 19 WARNINGs, 2 CONVENTIONs), plus NITs.
**Fixed:** 15 | **Deferred:** 6 (duplicates of recorded trade-offs, or accepted in the plan) | **Asked:** 0

**Validation:** focused at 84abdae5e on a clean tree: 53 test files covering every file that touches these routes,
functions and page handlers, plus the repo-wide audits (#1732, engine.reachable, reason-grep, win32 board copy). 2400
tests, 2313 pass, 0 fail, 87 skipped. The full suite runs after this proof, and its result goes on the PR.

### Per-iteration
- **1 (opus):** 2 W.
  - [W] the plan claimed every kplusDownload caller runs after filesPvOpen (false: cited chips) --> FIXED, corrected in the plan, CLAUDE.md and the PR.
  - [W] openFile's danger warning was dropped in the merge --> FIXED.
  - NITs taken: the orphan comment, a short read is refused.
  - Self-generated: 1, the plan prose claim. It was replaced with a statement that names every caller.
- **2 (sonnet):** 4 W.
  - [W] listed mode now gates Windows downloads, and its resolved-equals-walked check was never run there --> FIXED: `sameListedPath`, case-folded on win32, tested.
  - [W] the plan said chips download "as on main" --> FIXED.
  - [W] preview by extension only --> DEFERRED, recorded.
  - [W] HEAD runs a full preview --> DEFERRED, recorded.
- **3 (opus):** 1 W, plus a carded follow-up.
  - [W] the case-folded check let NODE_MODULES/x.png into node_modules --> FIXED: a skip check on the on-disk path, tested by staging win32 on a case-blind disk, red without it.
  - The cache outliving its PDF is carded as #5254. Angel is building it as PR #5256.
- **4 (sonnet):** 2 C new.
  - [C] CLAUDE.md said "picture" --> FIXED: png, jpeg, gif, webp.
  - [C] one comment line too long --> FIXED.
  - 3 W were duplicates of recorded trade-offs.
  - Found by a wider test run while fixing: engine.reachable flagged the unused fileInFolder alias --> removed.
- **5 (opus):** 2 W.
  - [W] the listed walk's lstat bypassed the fs-world seam --> FIXED: `lstatOfFolderPath`, plus a mapped-drive test.
  - [W] no swap test at the download's own open --> FIXED: link and FIFO arms, red with O_NOFOLLOW and sameOpenedFile removed.
- **6 (sonnet):** 2 W.
  - [W] the at-the-computer trade-off was not in the plan --> FIXED, recorded.
  - [W] the chips' change was not in the PR body --> FIXED, posted on the PR.
- **7 (opus):** 2 W.
  - [W] the preview's Show in File Explorer was refused on a mapped drive --> FIXED: win32explorer.revealFile takes namedAs, tested, red without it.
  - [W] the preview's Download gave a silent 204 on a refusal --> FIXED: it goes through kplusDownload, tested.
- **8 (sonnet):** 1 W new.
  - [W] a picture over the 25 MB cap opens the card --> FIXED, recorded in the plan as an accepted cost.
  - 2 W were duplicates.
- **9 (opus):** NITs only. **Converged.**

### Final ledger (rebase loop)
| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | plan, CLAUDE.md | SELF | false "every caller" claim | FIXED |
| 2 | 1 | WARNING | engine/projects.js | BRANCH | openFile warning dropped | FIXED |
| 3 | 2 | WARNING | engine/projects.js | SELF | win32 path equality unmeasured | FIXED |
| 4 | 2 | WARNING | plan | SELF | chips "as on main" | FIXED |
| 5 | 2 | WARNING | web/index.html | BRANCH | preview by extension | DEFERRED |
| 6 | 2 | WARNING | server.js | BRANCH | HEAD does a full preview | DEFERRED |
| 7 | 3 | WARNING | engine/projects.js | SELF | NODE_MODULES case slip | FIXED |
| 8 | 4 | CONVENTION | CLAUDE.md | SELF | "picture" too broad | FIXED |
| 9 | 4 | CONVENTION | server.js | SELF | long comment line | FIXED |
| 10 | 4 | WARNING | engine/projects.js | SELF | dead fileInFolder export | FIXED |
| 11 | 5 | WARNING | engine/projects.js | SELF | lstat bypassed the seam | FIXED |
| 12 | 5 | WARNING | server.file-download-5165.test.js | BRANCH | no swap test at the open | FIXED |
| 13 | 6 | WARNING | plan | BRANCH | at-the-computer trade-off unrecorded | FIXED |
| 14 | 6 | WARNING | PR | BRANCH | chips change not in the PR | FIXED |
| 15 | 7 | WARNING | engine/filepreview.js | BRANCH | reveal refused on a mapped drive | FIXED |
| 16 | 7 | WARNING | web/index.html | BRANCH | silent 204 on Download | FIXED |
| 17 | 8 | WARNING | plan | BRANCH | over-the-cap picture | FIXED |
| 18-21 | 3-8 | WARNING | various | BRANCH | duplicates of recorded trade-offs | DEFERRED |

### NITs carried (not applied)
- crossSiteRead now guards the download route, so a sibling computer's same-site read can no longer pull a download. Deliberate, and worth one plan line (iteration 9).
- No Windows-shaped swap test for sendFileDownload, i.e. with the O_NOFOLLOW seam taken away (iteration 9).
- No on-screen hint that a modifier-click opens the app (iterations 1, 9).
- The preview cache's eviction is oldest-drawn, not least recently used (iterations 5, 7).

---

## The original loop (before the rebase), kept as history


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
