---
pre_challenge: true
method: challenge-loop
branch: readonlyon-4455
diff_hash: edff2f9982b1e3096b2d27bf893eee86f3c95481cc59c34ac77827208d50ca27
validation: passed (full validation on this machine at head d4f3da5d6, 03:21 to 04:57 CDT 2026-10-14, queue included: node 20529 tests, 20286 pass, 0 fail; shell 234 of 234; the helper recorded clean under edff2f9982b1, this diff)
subdir_audit: passed
timestamp: 2026-10-14T09:58:28Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (four; one more after three of iteration 4's small points were applied; three more after main was merged in and a Linux step was added)
**Converged:** Yes
**Total findings:** 17 (0 BLOCKERs, 15 WARNINGs, 2 CONVENTIONs, 20 NITs)
**Fixed:** 10 | **Deferred:** 3 | **Duplicate of an earlier finding:** 4 | **Asked (awaiting user):** 0

This file was written by the session that followed the one that ran the loop. The ledger below was carried across a restart in a handoff file (icecreamkitty-night-2142.md), not re-derived. The commits it cites were checked against `git log` when this was written.

### Validation

**Of record: this machine, at d4f3da5d6** (the final head before this proof). The full validation passed; the run began and ended on the same head, and the helper's recorded hash equals this proof's. A copy queued on Mortals at the same head was stopped before it started its tests once this one passed.

**Earlier passes, at heads since superseded:** 5677a00d4 here (22:10, 10-13), and 08b4211ec on Mortals (02:00, 10-14; refused by mortals-validate.sh only because Mortals abbreviates object ids to 9 characters and this repo to 10, measured: the local diff at core.abbrev=9 gives Mortals' hash exactly; Baron has since fixed the script). After 08b4211ec, main was merged in (a What's New conflict, resolved by keeping both sides; this entry moved to 0.7.49) and a Linux CI step was added, so neither earlier pass covers the final head.

**The install test** (`tools/test-install.sh`, not part of the validation) ran in full on Mortals at 08b4211eca: 413 passed, 0 failed, with the three #4455 checks passing. The commits after it change `release/whats-new-pool.json` (the merge), `.github/workflows/test-linux-setup-4920.yml` and main's own files, none of which `tools/test-install.sh` exercises for this branch; that is argued from the file list, not re-run.

A slip on 10-13, said on the card (comment 6159686642): three uncommitted edits sat in the worktree for about half a minute as an earlier validation began. Those edits are now commit 08b4211eca and covered by every run since.

### Per-Iteration Breakdown

All Origin values are BRANCH by the fail-safe: no blame lookups were run for this loop.

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION
**Self-generated:** 0 of the above (not looked up; BRANCH by the fail-safe)
- [WARNING] tools/test-install.sh:1199: nothing automatic asserts the new default --> FIXED (ff37a383, 6a73ac58)
- [WARNING] release/whats-new-pool.json:411: the entry has no platforms tag, so it would show on Windows --> FIXED (ff37a383)
- [WARNING] install/setup.sh:1429: `=0` lasts one run and that was not said --> FIXED (ff37a383: documented; storing the choice was rejected)
- [WARNING] install/setup.sh:1426: an older installer rolling back over a locked app is unguarded --> FIXED (ff37a383 in the plan, 5677a00d in the doc)
- [CONVENTION] install/setup.sh:1425: the comment's "the release after" was untrue --> FIXED (ff37a383)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above (not looked up)
- [WARNING] install/setup.sh:1431: a short soak, and installers still being served that predate the change --> FIXED (69ac4056: both served files measured)
- [WARNING] .github/workflows/test-linux-setup-4920.yml:108: the check is empty under root, where no folder is unwritable --> FIXED (6a73ac58)

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs
**Self-generated:** 0 of the above (not looked up)
**Duplicates of prior findings:** 1
- [WARNING] install/setup.sh:1376: an interrupted swap leaves the app writable --> DEFERRED: it fails open (the app works, unlocked) and heals on the next update; the plan says so
- [WARNING] install/setup.sh:1428: the rollback hazard again --> DUPLICATE of iteration 1's, and the doc floor was added in 5677a00d
- [WARNING] tools/test-install.sh:1232: the macOS default is not checked automatically --> FIXED (5677a00d: DEFAULT arms in tools/test-update-locked-app-4455.sh, 40 pass; with the default turned off, 38 pass and 2 fail)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 9 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings.

#### Iteration 5 (after 08b4211eca, the three round-4 points applied post-convergence)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (not looked up)
- [WARNING] install/setup.sh:~1349-1395: lift-then-check cannot see chattr +i or deny-delete ACLs --> DEFERRED: by design, already named in the plan (line 75) and in the installer comment at setup.sh:1366
- [WARNING] docs/staging-channel.md:190: the 0.7.45 rollback floor is documentation only --> DUPLICATE of iteration 1 #4 / iteration 3 #9 (the rollback hazard; doc floor in 5677a00d). Suggestion to enforce via tools/lib/floor-gate.sh goes on the follow-up card.
- [NIT] release/whats-new-pool.json:~417: platforms mac only while Linux is locked too; rank 16 ties the previous entry (ties are allowed: choose() breaks them by since then title)
- [NIT] tools/test-update-locked-app-4455.sh:55: `[ Darwin ] && chflags` reads as if it could abort
- [NIT] the proof file is committed beside the plan (intended: the hook's artifact)
**Converged**: no new actionable findings.

#### Iteration 6 (after b146171800, main merged; the What's New conflict resolved, this entry moved to 0.7.49)
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (not looked up)
- [WARNING] install/setup.sh:1381-1389: the find walk's Linux arm (GNU find -exec test -e {}/. and symbolic -perm) was never run; the shards that run its test go to macOS --> FIXED (655da4ee: the Linux install workflow runs tools/test-update-locked-app-4455.sh)
- [NIT] a board-driven update's refusal reason lands only in logs/install.log (a follow-up could carry it into install.status)
- [NIT] an update interrupted between the lift and the swap leaves app/ writable (decided, in the plan)
- [NIT] the rollback floor is stated in prose in two places
- [NIT] tools/test-update-locked-app-4455.sh is mode 644 (sh runs it; the folder is already mixed)

#### Iteration 7 (after 655da4ee92, the Linux step added)
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 1 (the CONVENTION's line was written by 655da4ee, this loop's own fix)
- [WARNING] docs/staging-channel.md:190 / install/setup.sh:1426: the rollback floor is prose only --> DUPLICATE of #4 (third time raised; the plan names it the weakest premise and leaves the guard to the release lane)
- [CONVENTION] .github/workflows/test-linux-setup-4920.yml:11: the comment said the CONTROL arm runs on Linux; it is in the Darwin-only block --> FIXED (d4f3da5d: the claim is removed; the comment says which block skips)
- [NIT] on Ubuntu sh is dash, so NOISY there does not exercise the pipefail case
- [NIT] Linux installs get no What's New line (the pool allows mac and windows only)

#### Iteration 8 (after d4f3da5d6b)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (not looked up)
- [WARNING] release/whats-new-pool.json:453: Linux gets the lock but no What's New line --> DEFERRED: the pool's platforms are mac and windows only (engine/whatsnew.js:44); there is no Linux tag to add. The plan (line 254) records the Mac tag.
- [WARNING] install/setup.sh:~1375: chattr +i on Linux not caught ahead of time --> DUPLICATE of iteration 5's deferral (plan line 75, setup.sh:1366)
- [WARNING] install/setup.sh:~1431: false, no and empty count as on, silently --> DUPLICATE of round 4's point 1, decided in the plan (line 267) and on the follow-up list
- [NIT] a failed find sample re-locks a previously writable app after a refusal (conservative, documented)
- [NIT] the ORDER check hard-codes the rm -rf line's text
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-install.sh:1199 | BRANCH | Nothing automatic asserts the default | FIXED | ff37a383, 6a73ac58 |
| 2 | 1 | WARNING | release/whats-new-pool.json:411 | BRANCH | No platforms tag | FIXED | ff37a383 |
| 3 | 1 | WARNING | install/setup.sh:1429 | BRANCH | `=0` lasts one run, unsaid | FIXED | ff37a383 |
| 4 | 1 | WARNING | install/setup.sh:1426 | BRANCH | Old-installer rollback hazard | FIXED | ff37a383, 5677a00d |
| 5 | 1 | CONVENTION | install/setup.sh:1425 | BRANCH | Comment untrue | FIXED | ff37a383 |
| 6 | 2 | WARNING | install/setup.sh:1431 | BRANCH | Short soak, stale served installers | FIXED | 69ac4056 |
| 7 | 2 | WARNING | .github/workflows/test-linux-setup-4920.yml:108 | BRANCH | Check empty under root | FIXED | 6a73ac58 |
| 8 | 3 | WARNING | install/setup.sh:1376 | BRANCH | Interrupted swap leaves the app writable | DEFERRED | Fails open, heals on the next update |
| 9 | 3 | WARNING | install/setup.sh:1428 | BRANCH | Rollback hazard | DUPLICATE of 4 | 5677a00d adds the doc floor |
| 10 | 3 | WARNING | tools/test-install.sh:1232 | BRANCH | macOS default not checked automatically | FIXED | 5677a00d |
| 11 | 5 | WARNING | install/setup.sh:~1349 | BRANCH | Lift-then-check cannot see chattr +i or deny-delete ACLs | DEFERRED | Named in the plan (line 75) and at setup.sh:1366 |
| 12 | 5 | WARNING | docs/staging-channel.md:190 | BRANCH | The rollback floor is documentation only | DUPLICATE of 4 | Doc floor in 5677a00d; enforcing it goes on the follow-up card |
| 13 | 6 | WARNING | install/setup.sh:1381-1389 | BRANCH | The find walk's Linux arm was never run | FIXED | 655da4ee |
| 14 | 7 | WARNING | docs/staging-channel.md:190 | BRANCH | Rollback floor prose only | DUPLICATE of 4 | Third time raised |
| 15 | 7 | CONVENTION | .github/workflows/test-linux-setup-4920.yml:11 | SELF | Comment claimed the CONTROL arm runs on Linux | FIXED | d4f3da5d |
| 16 | 8 | WARNING | release/whats-new-pool.json:453 | BRANCH | Linux gets no What's New line | DEFERRED | The pool has no Linux platform (engine/whatsnew.js:44) |
| 17 | 8 | WARNING | install/setup.sh:~1431 | BRANCH | false, no, empty count as on | DUPLICATE | Round 4 point 1, in the plan and the follow-up list |

### A check that could not fail, found by running its control

The Linux workflow check's first form was `test A && test B` in one step. Under `bash -e` a failing `test A` in an `&&` list does not stop the step. Control run 38499195513, on a branch with the default turned off, passed. The fixed form (one test a line) is green in run 38499461803, and its control is red in run 38499467680.

### NITs (non-blocking, across all iterations)
- Iteration 4 raised nine small points, listed on the card (kosmos#4455, comment 6159686642). Three are now in the branch (08b4211eca: an honest What's New title, a rollback floor that names the release instead of a version, two checks that assert the file exists). The other six go on a follow-up card.
- Iteration 5: platforms is mac only while Linux is locked too; a Darwin-only cleanup line reads as if it could abort.

### Strengths (across all iterations)
- The default is asserted on both platforms by a check whose control has been seen red (iterations 1 to 3).
- The off switch and the fail-open behaviour are stated in the plan with their costs.
