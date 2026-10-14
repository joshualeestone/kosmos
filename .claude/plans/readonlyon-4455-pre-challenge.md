---
pre_challenge: true
method: challenge-loop
branch: readonlyon-4455
diff_hash: a831f73f4e3b86438e8578f362196c7b1547290785046f0bbd233c2d9fba27b5
validation: passed (full suite on head 5677a00d4, ended 22:10 CDT 2026-10-13: node 20401 tests, 20165 pass, 0 fail, 236 skipped; shell 234 of 234 commands). The helper recorded it under an older hash, see "Validation, and what is wrong with its record" below.
subdir_audit: passed
timestamp: 2026-10-14T03:10:59Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 10 (0 BLOCKERs, 9 WARNINGs, 1 CONVENTION, 9 NITs)
**Fixed:** 8 | **Deferred:** 1 | **Duplicate of an earlier finding:** 1 | **Asked (awaiting user):** 0

This file was written by the session that followed the one that ran the loop. The ledger below was carried across a restart in a handoff file (icecreamkitty-night-2142.md), not re-derived. The commits it cites were checked against `git log` when this was written.

### Validation, and what is wrong with its record

The full validation's test command joined the machine's queue at 19:17 CDT on head 83e1349de and its turn came at about 21:38, by which time the branch was at 5677a00d4 (committed 21:22). The suite ran on 5677a00d4: the wrapper's last line reads `VALIDATION_EXIT=0 at 22:10 head=5677a00d4`, and the tree was clean when it ended.

The validation helper takes its diff hash when a run starts and records that hash at the end. So its log holds a `clean` entry for hash 377c94f3ab83 (the 19:17 diff) and none for a831f73f4e3b (the diff this proof covers). That is kosmos#6126, found on this run. The claim "validation: passed" above rests on the suite's own tallies and the wrapper's head line, not on the helper's entry.

A slip, already said on the card (comment 6159686642): three uncommitted edits sat in this worktree from about 21:39:40 to 21:40:09 while the suite was in its first minute (docs/staging-channel.md, release/whats-new-pool.json, tools/test-install.sh). They were taken out. 232 tests had run by then; their names were searched for those three files and none matched. That nothing was affected is argued from test names, not measured.

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

### A check that could not fail, found by running its control

The Linux workflow check's first form was `test A && test B` in one step. Under `bash -e` a failing `test A` in an `&&` list does not stop the step. Control run 38499195513, on a branch with the default turned off, passed. The fixed form (one test a line) is green in run 38499461803, and its control is red in run 38499467680.

### The install test on Mortals

tools/test-install.sh is not part of the validation above. Its full form (without KOSMOS_INSTALL_GATE, which stops before this branch's checks) was green on Mortals at 6c4d1eccd8 and at c373bdb88d: 413 passed, 0 failed. A run at 5677a00d4 was queued at 21:40 and had not had its turn when this file was written; its result goes on the pull request.

### NITs (non-blocking, across all iterations)
- Iteration 4 raised nine small points. They are listed on the card (kosmos#4455, comment 6159686642) and are NOT in this branch: a commit here after the validation began would have voided it. Three of them are saved as a patch for a follow-up card.

### Strengths (across all iterations)
- The default is asserted on both platforms by a check whose control has been seen red (iterations 1 to 3).
- The off switch and the fail-open behaviour are stated in the plan with their costs.
