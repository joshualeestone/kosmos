---
pre_challenge: true
method: challenge-loop
branch: readonlyon-4455
diff_hash: 06ac52d009eff35e1249541cd320ba8e126d0b481873e6da83876bad56c53d33
validation: passed on Mortals (mortals-validate.sh at head 08b4211ec, ended 02:00 CDT 2026-10-14: node 20401 tests, 20157 pass, 0 fail, 244 skipped; shell 234 of 234 commands; helper status clean). Not recorded locally by that script, because Mortals spells the diff with 9-character ids and this repo with 10; see "Validation" below.
subdir_audit: passed
timestamp: 2026-10-14T07:02:05Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 (four, then one more after three of iteration 4's small points were applied)
**Converged:** Yes
**Total findings:** 12 (0 BLOCKERs, 11 WARNINGs, 1 CONVENTION, 12 NITs)
**Fixed:** 8 | **Deferred:** 2 | **Duplicate of an earlier finding:** 2 | **Asked (awaiting user):** 0

This file was written by the session that followed the one that ran the loop. The ledger below was carried across a restart in a handoff file (icecreamkitty-night-2142.md), not re-derived. The commits it cites were checked against `git log` when this was written.

### Validation

**Of record: Mortals, at 08b4211ec.** `mortals-validate.sh` ran the full validation in its own worktree there and the helper recorded `clean`. The script then refused to copy the entry here: its hash `4f95574abb0f` did not equal this worktree's `06ac52d009ef`. Measured why: the same three-dot diff hashed with 9-character object ids gives `4f95574abb0f` exactly, and this repository abbreviates to 10 (it holds more objects). Same base on both sides (`03ddf79b6147`). So it is the same code spelled two ways (the kosmos#6002 class), not a different diff.

A second run of the same validation was queued on this machine (5 runs back at 02:01); I stopped it once the Mortals result was read, rather than spend half an hour of the shared machine on the same answer. Its log ends `VALIDATION_EXIT=1` because it was stopped; it never started its tests.

**Earlier, at 5677a00d4** (before the three small fixes): the full validation passed here at 22:10 CDT on 10-13 (node 20401, 20165 pass, 0 fail; shell 234 of 234). The helper recorded it under the hash from when the run joined the queue at 19:17, which is kosmos#6126, found on that run. A slip during that run, said on the card (comment 6159686642): three uncommitted edits sat in the worktree for about half a minute as the suite began; 232 tests had run, none concerning those files (argued from test names, not measured). Those same three edits are now committed as 08b4211eca and covered by the Mortals run above.

**The install test** (`tools/test-install.sh`, not part of the validation) ran in full on Mortals at 08b4211eca: 413 passed, 0 failed, `INSTALL_TEST_FULL_EXIT=0` at 00:50 CDT, with the three #4455 checks passing (the default locks the app, `=0` leaves it writable, an update over a writable app locks it).

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

### A check that could not fail, found by running its control

The Linux workflow check's first form was `test A && test B` in one step. Under `bash -e` a failing `test A` in an `&&` list does not stop the step. Control run 38499195513, on a branch with the default turned off, passed. The fixed form (one test a line) is green in run 38499461803, and its control is red in run 38499467680.

### NITs (non-blocking, across all iterations)
- Iteration 4 raised nine small points, listed on the card (kosmos#4455, comment 6159686642). Three are now in the branch (08b4211eca: an honest What's New title, a rollback floor that names the release instead of a version, two checks that assert the file exists). The other six go on a follow-up card.
- Iteration 5: platforms is mac only while Linux is locked too; a Darwin-only cleanup line reads as if it could abort.

### Strengths (across all iterations)
- The default is asserted on both platforms by a check whose control has been seen red (iterations 1 to 3).
- The off switch and the fail-open behaviour are stated in the plan with their costs.
