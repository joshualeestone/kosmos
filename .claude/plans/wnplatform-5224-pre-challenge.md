---
pre_challenge: true
method: challenge-loop
branch: wnplatform-5224
diff_hash: 8102250294d78162c6e24655817008a2fdf0117ca7cbb5393148db5449b2ffcb
validation: passed (focused, not the full suite; see below)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-04T07:45:27Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes. Iteration 8 had zero NEW findings after deduplication and deferral.
**Total findings:** 20 actionable (0 BLOCKERs, 19 WARNINGs, 1 CONVENTION), plus NITs.
**Fixed:** 19 | **Deferred:** 1 | **Asked (awaiting user):** 0

**Validation, stated honestly.** The validation helper's full sequence (`yarn test`, the whole suite) needs the shared
heavy queue on Agent1s, which Splinter reserved for day-one runs until 07:00 CDT. That run is queued for after 07:00.
Run at HEAD 199d579a8 on a clean tree:
- 58 test files, exit 0: 2428 tests, 2324 pass, 0 fail, 104 skipped. The files are every test that reads whatsnew,
  whats-new, the release docs or the Windows build, plus the repo-wide audits that list and read files.
- server.test.js filtered to whats-new, #3955, #4928 and #5224: 5 of 5 pass.

Sabotage, each confirmed red:
- With the platform filter removed: 3 engine tests and the server route test fail.
- web/whats-new.json from main (untagged) is refused by the check (exit 3).

### Per-Iteration Breakdown

Origin column: every finding was classified at 6e. ITER_COMMITS was empty until iteration 1's fix. From iteration 2 on,
findings that cited code an earlier fix added were SELF code findings and were fixed normally. None was a prose claim
that needed deleting.

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/whatsnew.js:87: the cut rule and the committed-file test disagreed (one-way naming check) --> FIXED (8a2666cac): two-way rule
- [WARNING] engine/whatsnew.js:138: key() took no platform and was untested --> FIXED (8a2666cac)
- [WARNING] engine/whatsnew.js:43: the word list missed MacBook and iMac; the refusal offered only tagging --> FIXED (8a2666cac)
- [WARNING] tools/whats-new-check.js:51: the check printed the total count, not per platform --> FIXED (8a2666cac)
- [CONVENTION] .claude/plans/wnplatform-5224.md: a scheduling note in the plan --> FIXED (8a2666cac)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (code)
- [WARNING] engine/whatsnew.test.js:150: the committed-file test demanded a window on both platforms --> FIXED (34dd6f4f5)
- [WARNING] tools/whats-new-check.js:49: zero highlights for a platform passed silently --> FIXED (34dd6f4f5): stderr note
- [WARNING] engine/whatsnew.js:96: a mismatched tag was told to tag both platforms --> FIXED (34dd6f4f5)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (code)
- [WARNING] server.js:15408: no route-level test of the platform filter --> FIXED (e1b56b219): a server.test.js route test; sabotage turns it red
- [WARNING] engine/whatsnew.js:91: a superset tag got the wrong fix advice --> FIXED (e1b56b219)
- [WARNING] engine/whatsnew.js:43: the match was case-sensitive (missed MacOS, WINDOWS) --> FIXED (e1b56b219): added spellings

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (code)
- [WARNING] engine/whatsnew.js:43: re-raised; iteration 3's fix was too narrow (macos, Macintosh, OS X) --> FIXED (e7468dae5): match in any case except lower-case mac/macs/windows
- [WARNING] server.test.js:14201: the route test depended on an earlier seen record --> FIXED (e7468dae5)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above (code)
- [WARNING] tools/whats-new-check.js:49-54: the check's new output was untested --> FIXED (de221b3b0)
- [WARNING] tools/release.sh:688: a cut for a platform with no highlights of its own passed --> FIXED (de221b3b0): --platform from each caller, refuse with exit 3

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (code)
- [WARNING] engine/whatsnew.js:41-48: the lower-case "mac"/"windows" exemption --> FIXED (d9d6a7ca2): stated in the code comment and docs/releasing.md (context-guessing rejected as fragile)
- [WARNING] tools/release.sh:678-681: the opt-out message overclaimed --> FIXED (d9d6a7ca2)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 2 of the above (code and a header comment)
- [WARNING] tools/whats-new-check.js:56-67: the Mac cut's note did not say the Windows build will stop --> FIXED (199d579a8)
- [WARNING] tools/whats-new-check.js:4-11: the header omitted --platform and the new exit-3 reason --> FIXED (199d579a8)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 after deduplication
- [WARNING] engine/whatsnew.js:41-48: the word list's false positive and the lower-case gap --> duplicate of iteration 1 (FIXED) and iteration 6 (FIXED); confirmed resolved
- [WARNING] tools/build-kosmos-windows.sh:216: "an out-of-tree caller without --platform would skip the gate" --> DEFERRED: no such caller exists. `git grep whats-new-check` finds 4 callers and all pass --platform, and a test pins each one.
**Converged.**

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/whatsnew.js:87 | BRANCH | one-way naming rule vs test | FIXED | 8a2666cac |
| 2 | 1 | WARNING | engine/whatsnew.js:138 | BRANCH | key() no platform, untested | FIXED | 8a2666cac |
| 3 | 1 | WARNING | engine/whatsnew.js:43 | BRANCH | word list gaps, refusal advice | FIXED | 8a2666cac |
| 4 | 1 | WARNING | tools/whats-new-check.js:51 | BRANCH | total count, not per platform | FIXED | 8a2666cac |
| 5 | 1 | CONVENTION | plan | BRANCH | scheduling note in plan | FIXED | 8a2666cac |
| 6 | 2 | WARNING | engine/whatsnew.test.js:150 | SELF | demanded a window on both | FIXED | 34dd6f4f5 |
| 7 | 2 | WARNING | tools/whats-new-check.js:49 | SELF | silent zero for a platform | FIXED | 34dd6f4f5 |
| 8 | 2 | WARNING | engine/whatsnew.js:96 | BRANCH | wrong advice on mismatch | FIXED | 34dd6f4f5 |
| 9 | 3 | WARNING | server.js:15408 | BRANCH | no route-level test | FIXED | e1b56b219 |
| 10 | 3 | WARNING | engine/whatsnew.js:91 | SELF | superset tag advice | FIXED | e1b56b219 |
| 11 | 3 | WARNING | engine/whatsnew.js:43 | BRANCH | case-sensitive match | FIXED | e1b56b219 |
| 12 | 4 | WARNING | engine/whatsnew.js:43 | SELF | re-raised, fix too narrow | FIXED | e7468dae5 |
| 13 | 4 | WARNING | server.test.js:14201 | SELF | test depended on prior record | FIXED | e7468dae5 |
| 14 | 5 | WARNING | tools/whats-new-check.js:49 | SELF | new output untested | FIXED | de221b3b0 |
| 15 | 5 | WARNING | tools/release.sh:688 | BRANCH | own-platform zero passed | FIXED | de221b3b0 |
| 16 | 6 | WARNING | engine/whatsnew.js:41 | SELF | lower-case gap undocumented | FIXED | d9d6a7ca2 |
| 17 | 6 | WARNING | tools/release.sh:678 | SELF | opt-out message overclaimed | FIXED | d9d6a7ca2 |
| 18 | 7 | WARNING | tools/whats-new-check.js:56 | SELF | note did not warn of the later stop | FIXED | 199d579a8 |
| 19 | 7 | WARNING | tools/whats-new-check.js:4 | SELF | header stale | FIXED | 199d579a8 |
| 20 | 8 | WARNING | tools/build-kosmos-windows.sh:216 | BRANCH | hypothetical caller without flag | DEFERRED | no such caller; all 4 pinned |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations; the ones not already folded into fixes)
- [NIT] engine/whatsnew.test.js: the committed-file test can only fail if problems() is loosened, so its name claims more than it checks (iterations 3, 5, 7)
- [NIT] web/index.html:38867: a comment on what the board serves does not mention the platform filter (iteration 8)
- [NIT] tools/windows/RELEASING.md keeps one long added line (iteration 2)
- [NIT] on a board that is neither darwin nor win32, a both-platforms tag shows nowhere (iteration 3; such a board does not exist today)
- [NIT] the stderr note prints on every Mac cut of a Mac-only file (iteration 8; intended)

### Strengths (across all iterations)
- One filter in readFull: read, key, the GET route and the dismissal all follow it, the page is unchanged, and the tag is never served.
- problems() is shared by the board and both cuts, so an untagged "On a Mac" stops the release instead of reaching Windows.
- The tests have controls that can fail, and the cut call sites are pinned to their --platform.
- The plan names its weakest premise, and the route test now exercises it for the platform the test host is not.
