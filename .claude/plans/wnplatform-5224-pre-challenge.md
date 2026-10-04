---
pre_challenge: true
method: challenge-loop
branch: wnplatform-5224
diff_hash: f34f871b44dcba5672da8fcd8256adb65724736540ec119d83f7c7a5d2b2dfb7
validation: passed (focused, not the full suite; see below)
subdir_audit: passed (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-04T09:10:19Z
iterations: 14
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 14 (8 before PR #5238 opened. Angel's cross-review of the PR, a fix for it, then 6 more blind rounds.)
**Converged:** Yes. Iteration 14 had zero NEW findings after deduplication and deferral.
**Total findings:** 31 actionable (0 BLOCKERs, 30 WARNINGs, 1 CONVENTION), plus NITs.
**Fixed:** 29 | **Deferred:** 2 | **Asked (awaiting user):** 0

**Validation, stated honestly.** The validation helper's full sequence (`yarn test`, the whole suite) needs the shared
heavy queue on Agent1s, which Splinter reserved for day-one runs until 07:00 CDT. That run is queued for after 07:00.
Run at HEAD 91dbf8f41 on a clean tree (it was also run at 199d579a8 before the PR):
- 58 test files, exit 0: 2429 tests, 2325 pass, 0 fail, 104 skipped. The files are every test that reads whatsnew,
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
**Converged at the time (the proof was written here, and PR #5238 opened).**

#### Between 8 and 9: Angel's cross-review on PR #5238
- [WARNING] a dismissal keys on the file's version, not its words --> FIXED (782b92403): docs/releasing.md says a changed shipped file needs a new "version"

#### Iteration 9
**Reviewer model:** opus
- [WARNING] tools/windows/RELEASING.md: "Windows shows no window" was false since --platform (the build stops) --> FIXED (01213c5f2)
- [WARNING] docs/releasing.md: the same stale claim for both cuts --> FIXED (01213c5f2)
- [WARNING] engine/whatsnew.js + docs: implied a MAC address is excluded; upper-case "MAC" counts as the Mac --> FIXED (01213c5f2)
**Self-generated:** 3 (prose this loop wrote; each was replaced with a claim a test or probe guards)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] word-list gaps (Apple silicon, Finder) --> duplicate of iterations 3 and 4
- [WARNING] a contrast line ("Unlike on a Mac...") cannot ship under any tag --> FIXED (e71f286da): recorded in the plan as an accepted cost
- [WARNING] a future caller without --platform --> duplicate of iteration 8 (DEFERRED)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] engine/whatsnew.js: platformOf duplicated engine/platform's decision --> FIXED (c4f55e67f): the read's default is describe().platform, tested
- [WARNING] server.js /seen comment stale --> FIXED (c4f55e67f)

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] word-list gaps; title-case "Windows" --> duplicates (iterations 1, 3, 4, 10)
- [WARNING] tools/build-kosmos-windows.sh: the exit-3 hint led with the "also" fix --> FIXED (f38870bf1)

#### Iteration 13
**Reviewer model:** opus
**Disclosure:** this round's prompt added one line: the reviewer could judge the plan's accepted costs, but a limit the plan accepts on purpose is not by itself a new finding. That steers what counts as a finding, so it is recorded here. Iteration 14 used the unmodified prompt.
- [WARNING] tools/release.sh opt-out message named the wrong condition and left out a malformed file --> FIXED (91dbf8f41)
- [WARNING] "MacOSX" (one token) was not caught --> FIXED (91dbf8f41), tested

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] title-case "Windows" / "PC-free" false positives --> duplicate of iterations 1 and 12
- [WARNING] a file with a naming problem serves no window on any platform at runtime --> DEFERRED: by design. It is the module's existing fail-closed rule (#3955): any problem, including a malformed "also", serves the whole file as none, and the header says so. The cut check stops such a file before it ships.
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
| 21 | PR | WARNING | engine/whatsnew.js (dismissal) | BRANCH | dismissal keys on version | FIXED | 782b92403 |
| 22 | 9 | WARNING | tools/windows/RELEASING.md | SELF | stale "shows no window" | FIXED | 01213c5f2 |
| 23 | 9 | WARNING | docs/releasing.md | SELF | stale "shows no window" | FIXED | 01213c5f2 |
| 24 | 9 | WARNING | engine/whatsnew.js comment | SELF | MAC address implied excluded | FIXED | 01213c5f2 |
| 25 | 10 | WARNING | plan | BRANCH | contrast line unshippable, unrecorded | FIXED | e71f286da |
| 26 | 11 | WARNING | engine/whatsnew.js:132 | SELF | own platform mapping | FIXED | c4f55e67f |
| 27 | 11 | WARNING | server.js:15422 | BRANCH | /seen comment stale | FIXED | c4f55e67f |
| 28 | 12 | WARNING | tools/build-kosmos-windows.sh:219 | SELF | exit-3 hint | FIXED | f38870bf1 |
| 29 | 13 | WARNING | tools/release.sh:684 | SELF | opt-out message wrong | FIXED | 91dbf8f41 |
| 30 | 13 | WARNING | engine/whatsnew.js:43 | SELF | MacOSX missed | FIXED | 91dbf8f41 |
| 31 | 14 | WARNING | engine/whatsnew.js (readFull) | BRANCH | runtime fail-closed on any problem | DEFERRED | by design (#3955 rule) |

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
