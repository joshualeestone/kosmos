---
pre_challenge: true
method: challenge-loop
branch: queuewrap-4977
diff_hash: e454560a575fc1f0e6518cdfbcac8594f8c981c8f3422810fcc2320c234e0e7a
validation: passed (Mortals full suite at 477ecc6c0, 2026-10-03 02:20 CDT, hash e454560a575f)
subdir_audit: passed
timestamp: 2026-10-03T07:28:48Z
iterations: 8
converged: true
---


## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (a new loop after rebasing onto main once #4911 merged as #5005; the pre-rebase loop converged at review 6)
**Converged:** Yes
**Total findings:** 19 distinct actionable (0 BLOCKERs, 16 WARNINGs, 3 CONVENTIONs), plus 31 NITs; re-raised duplicates are counted once
**Fixed:** 14 | **Deferred:** 5 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] tools/test-queued-heavy-4977.sh:155-160: temp-file cleanup arm passes if the files were never made --> FIXED (07e44b907: fixture arm requires them in TMPDIR; mutant turns it red)
- [WARNING] tools/queued-heavy.sh:16-17: header says the live copy is installed from this file --> FIXED (07e44b907: reworded, nothing checks the two match)
- [WARNING] .claude/plans/queuewrap-4977.md:36-37: validation predates review 5 and the rebase --> FIXED (3387c2471: run recorded at the new head)
- [CONVENTION] .claude/plans/queuewrap-4977.md:5-6,29: "Stacked on #4911" section stale --> FIXED (07e44b907)
- [NIT] tools/test-queued-heavy-4977.sh:47: ok prints an earlier arm's output
- [NIT] tools/queued-heavy.sh:44: default lib checkout path is fleet-specific
- [NIT] tools/queued-heavy.sh:192-195: pid reuse after reap not noted
- [NIT] tools/test-queued-heavy-4977.sh:110: browser-flip watchers not in BG

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/queued-heavy.sh:153-161: `_qh_take` stale-lock takeover can admit two waiters --> DEFERRED: #4911's lock design already in the live copy; this branch pins the wrapper, it does not redesign the lock; logged on #4977 as a follow-up with call, rejected option and weakest premise
- [WARNING] tools/test-queued-heavy-4977.sh:121-136: relative real scripts (`bash tools/test-install.sh`) could run if a refusal lapsed --> FIXED (967b33f52: the test runs from an empty dir)
- [WARNING] tools/test-queued-heavy-4977.sh: timing-dependent arms may flake on Linux CI --> DEFERRED: the suite job runs on macos-latest (test.yml), and every wait is bounded
- [CONVENTION] .claude/plans/queuewrap-4977.md:39: validation sha predates later edits --> DEFERRED: the later commit was plan-only (re-recorded at final head in iteration 5/7)
- [NIT] tools/queued-heavy.sh:249-252: no TERM trap in the main lane
- [NIT] tools/queued-heavy.sh: review-round tags in comments
- [NIT] tools/queued-heavy.sh:45: default checkout is a hidden prerequisite

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (lock takeover, deferred)
- [WARNING] tools/queued-heavy.sh:14,45: comments say the guards are read from a checkout at origin/main; nothing keeps it there --> FIXED (fe3c8a195: reworded)
- [NIT] tools/test-queued-heavy-4977.sh:40-42: some arms still `cd /tmp`
- [NIT] tools/test-queued-heavy-4977.sh:113: browser-flip watchers not in BG
- [NIT] tools/queued-heavy.sh:307,313: capper has no pid-reuse guard
- [NIT] tools/queued-heavy.sh:287: QH_DESC mktemp failure is silent
- [NIT] package.json:16: about 80 s added to a shell shard

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (lock takeover, deferred)
- [WARNING] tools/queued-heavy.sh:46: the missing-lib failure has no arm --> FIXED (e905768da: exit-3 arm, 77)
- [WARNING] package.json: no `bash -n` of either script in test:shell --> FIXED (e905768da)
- [WARNING] tools/test-queued-heavy-4977.sh:49: hand-written machine-claim format --> DEFERRED: a format change turns the hold arms red, never green
- [WARNING] .claude/plans/queuewrap-4977.md: "an EXIT trap cleans up" overstates what it stops --> FIXED (e905768da)
- [NIT] tools/test-queued-heavy-4977.sh:170: EXPECTED recompute not explained
- [NIT] tools/test-queued-heavy-4977.sh:11: unquoted $S
- [NIT] tools/test-queued-heavy-4977.sh:19: Linux pgrep semantics
- [NIT] .claude/plans/queuewrap-4977.md:41: validation sha

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] .claude/plans/queuewrap-4977.md:41-42: validation records 76 after the 77th arm --> FIXED (f253b318b)
- [NIT] tools/queued-heavy.sh:5: header cites run-tests.sh "~line 224" --> taken in f253b318b (names _rt_box_clear)
- [NIT] tools/test-queued-heavy-4977.sh:50: ok output of a previous arm
- [NIT] tools/test-queued-heavy-4977.sh:117: SIGPIPE watcher not in BG
- [NIT] tools/queued-heavy.sh:46: rollout should create the default path

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 2 (lock takeover; live copy installed separately, reworded in iteration 1)
- [WARNING] tools/queued-heavy.sh:46-48: load check names only kosmos_wait_until_clear; a stale lib missing another function waits out the bound --> FIXED (dd91e8040: every main-lane function, old-lib arm, 78; mutant turns it red)
- [WARNING] tools/queued-heavy.sh:46: default path untested --> DEFERRED: the plan's named weakest premise; both lib arms pin the failure mode
- [CONVENTION] .claude/plans/queuewrap-4977.md:42-45: validation section partly stale --> FIXED (df16945d4, 7838ebfbb)
- [NIT] tools/test-queued-heavy-4977.sh:11: unquoted $S
- [NIT] tools/test-queued-heavy-4977.sh:174: hand-maintained count

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the load-check finding: dd91e8040 wrote it and the plan line)
**Duplicates of prior findings:** 1 (lock takeover)
- [WARNING] tools/queued-heavy.sh:48-51: "every function" omits the side lane's take/publish/release --> FIXED (90196c2bd: checked whenever the side gate exists, by declare -F; half-lib arm, 79; mutant turns it red)
- [WARNING] .claude/plans/queuewrap-4977.md: done-sentence says agents run this file --> FIXED (90196c2bd: installing is a separate step)
- [NIT] tools/queued-heavy.sh:50: command -v also matches a PATH executable --> taken (declare -F)
- [NIT] tools/test-queued-heavy-4977.sh:22-24: two env vars not unset --> taken (90196c2bd)
- [NIT] tools/queued-heavy.sh:46: card-named default path
- [NIT] tools/test-queued-heavy-4977.sh:117: SIGPIPE watcher not in BG
- [NIT] tools/test-queued-heavy-4977.sh:56-59: some arms `cd /tmp`

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 3 (stale default lib: deferred iteration 6; lock takeover: deferred; test:shell length: the reviewer called it acceptable, same as iteration 2's timing item)
- [NIT] tools/queued-heavy.sh:38: `-e && ! -x` refusal can trip on a cwd file
- [NIT] tools/test-queued-heavy-4977.sh:173: lib fixtures copy only cut-guard.sh
- [NIT] tools/test-queued-heavy-4977.sh:11: unquoted $S
- [NIT] tools/test-queued-heavy-4977.sh:183: count breakdown comment
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-queued-heavy-4977.sh:155 | BRANCH | cleanup arm vacuous if files never made | FIXED | 07e44b907 |
| 2 | 1 | WARNING | tools/queued-heavy.sh:16 | BRANCH | header claims live copy installed from it | FIXED | 07e44b907 |
| 3 | 1 | WARNING | .claude/plans/queuewrap-4977.md:36 | BRANCH | validation predates review 5 + rebase | FIXED | 3387c2471 |
| 4 | 1 | CONVENTION | .claude/plans/queuewrap-4977.md:5 | BRANCH | stacked-on section stale | FIXED | 07e44b907 |
| 5 | 2 | WARNING | tools/queued-heavy.sh:153 | BRANCH | stale-lock takeover race | DEFERRED | #4911 design, follow-up on #4977 |
| 6 | 2 | WARNING | tools/test-queued-heavy-4977.sh:121 | BRANCH | relative real scripts could run | FIXED | 967b33f52 |
| 7 | 2 | WARNING | tools/test-queued-heavy-4977.sh | BRANCH | Linux/flaky CI | DEFERRED | suite runs on macos-latest |
| 8 | 2 | CONVENTION | .claude/plans/queuewrap-4977.md:39 | BRANCH | validation sha | DEFERRED | later commit plan-only |
| 9 | 3 | WARNING | tools/queued-heavy.sh:14 | BRANCH | guards "from origin/main" claim | FIXED | fe3c8a195 |
| 10 | 4 | WARNING | tools/queued-heavy.sh:46 | BRANCH | missing-lib failure untested | FIXED | e905768da |
| 11 | 4 | WARNING | package.json | BRANCH | no bash -n entries | FIXED | e905768da |
| 12 | 4 | WARNING | tools/test-queued-heavy-4977.sh:49 | BRANCH | hand-written claim format | DEFERRED | fails red, not green |
| 13 | 4 | WARNING | .claude/plans/queuewrap-4977.md:19 | BRANCH | trap claim overstated | FIXED | e905768da |
| 14 | 5 | WARNING | .claude/plans/queuewrap-4977.md:41 | BRANCH | validation 76 after 77th arm | FIXED | f253b318b |
| 15 | 6 | WARNING | tools/queued-heavy.sh:46 | BRANCH | load check one function | FIXED | dd91e8040 |
| 16 | 6 | WARNING | tools/queued-heavy.sh:46 | BRANCH | default path untested | DEFERRED | named weakest premise; lib arms pin failure |
| 17 | 6 | CONVENTION | .claude/plans/queuewrap-4977.md:42 | BRANCH | validation section stale | FIXED | df16945d4 |
| 18 | 7 | WARNING | tools/queued-heavy.sh:48 | SELF | side-lane functions unchecked | FIXED | 90196c2bd |
| 19 | 7 | WARNING | .claude/plans/queuewrap-4977.md:9 | BRANCH | done-sentence overstated | FIXED | 90196c2bd |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
Listed per iteration above. Taken: run-tests.sh line reference (iteration 5), declare -F and two env vars (iteration 7).

### Strengths (across all iterations)
- The shim refuses any run whose marker dir is outside the test's temp dir, and a control arm proves it refuses (every iteration)
- Cleanup by parentage, this tree's path and exact unique sleep lengths; no broad kills (iterations 1-8)
- An exact arm count (79) so a killed or short run cannot pass; recounted independently by reviewers (iterations 1, 3, 5, 7)
- Zombie-aware liveness applied at every caller (iterations 3, 5, 7)
- Honest scope: the live copy, the stale default checkout and the lock race are all named, not hidden (iterations 4, 8)
