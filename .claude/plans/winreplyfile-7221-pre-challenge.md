---
pre_challenge: true
method: challenge-loop
branch: winreplyfile-7221
diff_hash: 726cfd9cde41b2c4b216872e7fa31e8c693cb1023032c6ded63704fe7bb29e35
validation: targeted Windows suites passed on the box (full suite via CI: npm test makes real schtasks calls on this box, not run here; the validation-log helper was not run)
subdir_audit: passed
timestamp: 2026-10-26T21:11:02Z
iterations: 28
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 28
**Converged:** No. It converged at iteration 25. Windows CI then failed two arms and the code changed, so the loop re-opened. It STOPPED after iteration 28 by the fleet's review-loop rule: Splinter's HEADS-UP over Slack, 2026-10-26 16:08 CDT, says: "a review loop stops at 8 rounds unless a BLOCKER is still open; past 8, WARNINGs go to a follow-up card, not another round ... apply it from the next loop (including #7243's re-run)". Iteration 28 had no BLOCKER; its WARNINGs are on #7250.
**Total actionable findings:** 68 (8 BLOCKERs, 47 WARNINGs, 13 CONVENTIONs), plus NITs
**Fixed:** 56 | **Deferred:** 12 | **Asked (awaiting user):** 0

Validation, stated as it happened: on the Windows box, with the runtime node and the no-schtasks preload, on the final
code: engine/replyfile.win32-7221.test.js 58/58 with CI=1 and an 8.3 short-name TMP (57 + 1 CI-only skip without CI), engine/winpath.test.js 3/3, engine/windows-tests-1777
23/23, engine/windows-coupling-audit-1732 8/8, engine.reachable 8/8, engine/win32zip 22/22, engine/backuprestore 24/24,
server.reply-file-6726 53/56 and server.attachment-stream-6734 25/31: the same failures as origin/main on this box, by
name and error line (Mac-only FIFO/NFD/O_NONBLOCK, download streaming). Each review round's new arms were run against
the previous iteration's code as a negative control and failed there. The full suite runs in CI (macOS, Linux, and
windows.yml for the win32-named files).

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] engine/replyfile-win-7221.test.js — not picked by the Windows CI runner (no `win32` in the name) --> FIXED (renamed)
- [WARNING] engine/replyfile.js — mapped-drive project files refused (regression) --> FIXED
- [WARNING] engine/replyfile.js — other project folders still resolved (SMB contact) --> FIXED (share-written skipped; rest named)
- [CONVENTION] plan — missing Posture stamp --> FIXED

#### Iteration 2
- [BLOCKER] engine/replyfile.js — `\??\GLOBALROOT\Device\Mup` link target slipped a `\\` deny rule (21 s stall measured) --> FIXED (allow-list)
- [WARNING] second guard exempted every file on a project drive --> FIXED
- [WARNING] share-resolved file resolved every share-written project --> FIXED

#### Iteration 3
- [WARNING] project folder that is a local link to a share still resolved --> FIXED
- [WARNING] share-written projects could no longer attach --> FIXED (decided: allowed inside own share folder; told the card author)
- [WARNING] same-share branch nearly unreachable --> FIXED

#### Iteration 4
- [WARNING] root behind a junction to another local drive refused --> FIXED (drives reached through root links)
- [WARNING] shares matched by spelling, not identity --> DEFERRED: narrow, named in code and plan, remedy stated

#### Iteration 5
- [WARNING] skipped nested project failed OPEN --> FIXED (fail closed)
- [WARNING] every attach walked all project links --> FIXED (lazy)
- [WARNING] subst letter collision/leak in tests --> FIXED
- [CONVENTION] allowedRoot signature --> FIXED
- [CONVENTION] tests stub module exports --> DEFERRED: controls go red if stubs stop taking effect

#### Iteration 6
- [WARNING] walk of every project folder adds contact --> DEFERRED: same server folderState touches; tracked #7232
- [WARNING] Q:\x triggers a walk of own roots --> FIXED (named)
- [CONVENTION] third device-name regex --> FIXED (one shared rule)
- [CONVENTION] Windows path policy inside the attach module --> FIXED (engine/winpath.js)

#### Iteration 7
- [WARNING] exact-case listed() let a re-cased junction through --> FIXED
- [WARNING] merged device rule widened restore --> FIXED (no behaviour change in any module)

#### Iteration 8
- [WARNING] namespace-spelled nested project failed open --> FIXED

#### Iteration 9
- [WARNING] r4-3 flake unexplained --> FIXED (root cause: 64-bit NTFS ids compared as numbers; a real fail-open, now BigInt)
- [CONVENTION] two copies of the link walk --> FIXED
- [CONVENTION] object posing as RegExp --> FIXED

#### Iteration 10
- [WARNING] local-volume link reported as network --> FIXED

#### Iteration 11
- [BLOCKER] skip of an unfollowable LOCAL link failed open (reproduced) --> FIXED
- [WARNING] own project link to a share refused --> FIXED (decided: allowed, as on main)
- [WARNING] root-relative link targets refused --> FIXED
- [WARNING] walk cost needs a card --> FIXED (#7232)

#### Iteration 12
- [WARNING] walk stopped at the own-share link --> FIXED
- [WARNING] a pipe-namespace row made all project attaches refuse --> FIXED

#### Iteration 13
- [WARNING] chain over 32 links still resolved --> FIXED
- [CONVENTION] sameWrittenPath duplicated a normalizer --> FIXED

#### Iteration 14
- [WARNING] deny-list for "network" link targets (Global\UNC resolved) --> FIXED (allow-list for local)

#### Iteration 15
- [WARNING] another agent's dead junction to a share resolved --> FIXED

#### Iteration 16
- [BLOCKER] local link into the agent's share project failed open (reproduced) --> FIXED (skipped folders judged by where the walk led)
- [WARNING] spelling vs identity disagreement --> FIXED (same)
- [WARNING] unknown share destinations --> FIXED (same)

#### Iteration 17
- [WARNING] connected agent's Files on a share regressed --> FIXED
- [WARNING] recorded agent folders stat a share --> FIXED (named precisely; #7232)
- [WARNING] unreadable link of another agent resolved --> DEFERRED: realpath stays local for every readlink-failure case
- [CONVENTION] stale 32-links comment --> FIXED

#### Iteration 18
- [WARNING] walk/roots should be their own module --> DEFERRED: one caller; extract with #7232 (reason in plan)

#### Iteration 19
- [WARNING] local-volume folder not walked --> FIXED
- [WARNING] NT `\??\` share spellings read as local --> FIXED

#### Iteration 20
- [WARNING] earlier link changes the spelling (own share link) --> FIXED (named as residual (d))
- [WARNING] Windows arms run only on win32 --> DEFERRED: windows.yml runs every win32-named test file

#### Iteration 21
- [WARNING] an agent can register a share project and attach from it --> FIXED (named as residual (e); create-time fix on #7229)
- [WARNING] readOwn re-resolve after the open had no walk --> FIXED (recheck)
- [CONVENTION] caveats out of order --> FIXED
- [CONVENTION] test-only export --> FIXED (winSpellingRefusalForTests, EXCUSED)

#### Iteration 22
- [WARNING] `\??\Global\C:\` nested project failed open --> FIXED
- [CONVENTION] no winpath test file --> FIXED (engine/winpath.test.js)

#### Iteration 23
- [WARNING] chained alias nested project failed open --> FIXED ("holds no files" is an allow-list)

#### Iteration 24
- [WARNING] root-walk cache not shared with the recheck --> FIXED

#### Iteration 25
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 new CONVENTIONs (1 duplicate of the deferred comment-style entry), 4 NITs
**Converged.**

#### After iteration 25: Windows CI on PR #7243
**New findings:** 1 BLOCKER (a fail-open)
- [BLOCKER] engine/winpath.js mayHold: another agent's link written with an 8.3 short name (CI's temp is
  C:\Users\RUNNER~1) never matched the long real path, so their file attached --> FIXED (82513cdbf2; short-name
  segment stands for any one segment on the refusing side; reproduced with an 8.3 TMP; the previous winpath fails
  exactly that arm). The 21-2 arm's failure was test-only (fixed in the same commit).

#### Iteration 26
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs (1 WARNING duplicating the main baseline), 4 NITs
- [WARNING] engine/replyfile.js skippedMayHold: an unplaceable other-agent folder refused with NOT_YOURS, false
  and undiagnosable --> FIXED (d427e56bf5; OTHER_FOLDER_UNPLACED; arm with Files and row-removed controls)

#### Iteration 27
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION (1 duplicate CONVENTION), 4 NITs
- [WARNING] engine/winpath.js LOCAL_VOLUME: shadow-copy volumes read as unplaceable --> FIXED (8b2e0aa672)
- [WARNING] test arms skip silently when setup is missing --> FIXED (8b2e0aa672; setupSkip fails on Windows CI;
  control: admin share made unreachable, CI mode fails 8 arms, plain mode skips them)
- [WARNING] growing predicate set; single classifier unfiled --> DEFERRED (filed #7249, linked from plan and header)
- [CONVENTION] plan name has no timestamp --> DEFERRED (repo plans are named <branch>.md; proof lookup is by branch)

#### Iteration 28 (last: fleet round cap)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] ownShareProject matches roots.folders (Files included): a Files folder that is a symlink to a share
  is resolved before filesRoot refuses it --> DEFERRED to #7250 (fleet rule; also a NIT in 25 and 26)
- [WARNING] setupSkip unproven on a real windows-latest runner --> DEFERRED to #7250; PR #7243's CI run answers it

### Deferred (with reasons)
- Shares matched by spelling (iteration 4): narrow; named in code and plan.
- Tests stub exports (5): the control arms fail if the stubs stop taking effect.
- Per-attach walk cost (6, 11, 17, 24 NIT): tracked on #7232.
- Unreadable link of another agent resolved (17): realpath stays on this computer in every readlink-failure case.
- Walk/roots module extraction (18): one caller; extract with #7232.
- Windows-only arms (20): Windows CI runs them.
- Review-number citations in comments (raised as CONVENTION in 7 rounds): this module's existing #6726 comments
  use the same style; the history is also in the plan.

### NITs (non-blocking, latest round)
- ownShareProject checks roots.folders (includes Files): a Files folder linked to a share is resolved before
  filesRoot refuses it (one contact, no leak).
- Drive-relative and `\Device` link targets are told "network".
- The lstat-count arm (=2) is brittle to refactors.
- Long destructured import from winpath.

### Strengths (across iterations)
- The premise was measured (21 s realpath stall vs 0 ms lstat/readlink) and drives the design.
- Every refusal arm asserts zero realpath calls and a time bound, with negative controls per round.
- Allow-lists for followed link targets and for "holds no files"; skipped folders judged by where they lead.
- BigInt file ids fix a measured identity collision present on main.
- One shared device-name rule with no behaviour change, pinned by its own test.
