---
pre_challenge: true
method: challenge-loop
branch: exittrap-6826
diff_hash: 2d0fb6d2a0babf249f07aab4f27ca07286893677d38ea22e130300ee50c46731
validation: passed (Mortals, full suite, clean entry 2026-10-21T13:26:24Z, 22856 node tests, 0 failed)
subdir_audit: passed
timestamp: 2026-10-21T13:26:36Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Re-hashed 2026-10-21 16:20 CDT after a second rebase onto main** (the first was 13:2x). The only conflict was
package.json `test:shell`, resolved as main's line plus this branch's two entries for
tools/test-deploy-site-exit-trap-6826.sh (computed against the merge base: nothing removed, nothing already on main).
No code changed. On the rebased head: test-deploy-site-exit-trap-6826.sh rc 0, test-deploy-site-exit0-2791.sh rc 0,
tools.every-test-runs + engine.reachable 11/0. The full Mortals suite ran at the pre-rebase hash (22856 tests, 0
failed); the PR's CI validates the rebased tree.

**Iterations:** 8
**Converged:** Yes
**Total findings:** 9 actionable (0 BLOCKERs, 7 WARNINGs, 2 CONVENTIONs) plus NITs
**Fixed:** 7 | **Deferred:** 2 | **Asked (awaiting user):** 0
(Duplicates of earlier entries are counted once.)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above (no loop commits yet)
- [CONVENTION] .claude/plans/: no plan file --> FIXED (be9662b)
- [NIT] trap comment said "replaced for the whole run" --> FIXED (be9662b)
- [NIT] message narrower than what the trap catches --> FIXED (be9662b)
- [NIT] pin P comment overstated its reach; file mode 644; no bash -n arm --> FIXED (be9662b)
- [NIT] control C passes either way --> stated (R1 is the arm that can fail)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/deploy-site.sh: the old plain trap stayed armed between the block's trap and the new one --> FIXED (09a29ed: the finished check IS the block's trap, unset flag counts as finished)
- [WARNING] tools/test-deploy-site-exit-trap-6826.sh: no arm runs the real script --> FIXED (09a29ed: E1/E2 inject a death into a copy of the real script; EC control; placement mutant goes red)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] test: on a shell that keeps the status, R1/R2/E1/E2 would false-red on the message --> FIXED (06b74fd: controls run first; the message is required only where the shell loses the status)
- [NIT] message wording for untrapped signals; plan line numbers; inline exit 0 not pinned --> FIXED (06b74fd)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (new), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] comments or plan claim "every way the script can end" --> DEFERRED: no such text exists (searched comment, test and plan); the plan's weakest premise already states coverage starts at the trap line
- test-strength-on-other-shells WARNING --> duplicate of iteration 3

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the dry-run success exit is not exercised by any test --> FIXED (26acac9: B1d in test-deploy-site-exit0-2791.sh runs a completed dry run; dropping the flag makes it red)
- [NIT] injected-line marker; message wording after a publish --> FIXED (26acac9)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (new), 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 (the trap message's cause list and its "may already be live" clause were loop-written prose)
- [WARNING] tools/deploy-site.sh trap message: "or a signal" and "may already be live" over-claim --> FIXED (09776d8: both claims DELETED, not reworded; the message says the run stopped, the cause is above, treat it as failed)
- "every way" scope WARNING --> duplicate of iteration 4

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION (plan present, no action), 2 NITs
**Self-generated:** 1 (pin P's header promised "after `;`", which the pattern did not check)
- [WARNING] pin P misses `|| exit 0`, `exit 0 # comment`, bare `exit`, `exit "$rc"` --> FIXED (1fe555c: P checks every exit in command position outside quotes; two mutants on the real file go red, quoted prose and awk exits do not false-flag)
- [NIT] fixture commit and commit.gpgsign --> FIXED (1fe555c)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (new), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 1 (the unset-means-finished default = iteration 2's design; the reviewer notes E1/E2 catch a moved flag)
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | be9662b |
| 2 | 2 | WARNING | tools/deploy-site.sh | BRANCH | old trap armed for a window | FIXED | 09a29ed |
| 3 | 2 | WARNING | tools/test-deploy-site-exit-trap-6826.sh | BRANCH | real script never run | FIXED | 09a29ed |
| 4 | 3 | WARNING | tools/test-deploy-site-exit-trap-6826.sh | BRANCH | false red on a status-keeping shell | FIXED | 06b74fd |
| 5 | 4 | WARNING | (comments, plan) | BRANCH | "every way" claim | DEFERRED | text not present |
| 6 | 5 | WARNING | tools/deploy-site.sh dry-run exit | BRANCH | success path not run by a test | FIXED | 26acac9 |
| 7 | 6 | WARNING | tools/deploy-site.sh trap message | SELF | message over-claims | FIXED | 09776d8 (deleted) |
| 8 | 7 | WARNING | tools/test-deploy-site-exit-trap-6826.sh pin P | SELF | pin narrower than its header | FIXED | 1fe555c |
| 9 | 7 | CONVENTION | .claude/plans/ | BRANCH | plan present (reviewer note) | DEFERRED | no action needed |

### Validation

Full suite on Mortals for each committed head that ended a fix round: 08eecf7 (clean, 22856/0), be9662b (clean), and the
converged head 1fe555c (clean, 13:26:24Z, 22856 node tests, 0 failed, the new shell test and B1d both in the log).
Local: test-deploy-site-exit-trap-6826.sh (11 arms), test-deploy-site-exit0-2791.sh (B1d added), test-deploy-site-fetch-4745.sh
(45 arms), test-deploy-site-staged-mac-4819.sh, tools.every-test-runs and tools.shell-shard-4317. By hand on Agent1s: the
06:13 incident input exits 1 (was 0); a good dry run exits 0.

### Known, stated, not changed

The plan's scope line ("about 40 other scripts... an EXIT trap plus set -u") was written before the mechanism was
narrowed: loss needs `set -e` AND an EXIT trap. Measured table and the 7 affected non-test scripts are on #6826 and
filed as #6831. The plan is left as written so this proof's hash stays the validated diff; the PR body carries the
correction.

### NITs (non-blocking)
- The trap line is one long line; a named function would read better but the test lifts the line by its prefix (iteration 7)
- package.json test:shell is one long string (pre-existing convention) (iteration 8)

### Strengths
- The trap under test is lifted from the source, not hand-copied; E1/E2 run the real script with an injected death
- Controls (C, EC) reproduce the exit-0 bug with the old trap on this shell, so the arms measure the real danger
- Every non-zero status (1, 75, 77, 130, 143) passes through unchanged; only an unflagged 0 becomes 1
