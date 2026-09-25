---
pre_challenge: true
method: challenge-loop
branch: gatectl-testsupport-3691
diff_hash: 222bf0ccc3d8cc02a76a7e7b0a57fa17d7017e42dda3deca247f7110f07a65a8
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T06:22:51Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

Reviewer checked every caller of test-install.sh against the new guard:
- release.sh 4b runs from a full frozen worktree (release_freeze uses git worktree add), so test-support/ is present.
- package.json test:install and test:install-gate run from the repo root.
- CI never runs it; test:shell only syntax-checks it.
- test-build-smoke-sandbox.sh audits `export ` lines only.
- test-cut-guard.sh stubs its own copy.

It also confirmed that fake-tmux.sh is committed 100755, so `-x` is right. The guard sits after SB and the EXIT trap, so there is no leak. The FAIL line uses the harness's two-space format and is captured by 4b's 2>&1 grep.

### Final Ledger

(no actionable findings)

### NITs (non-blocking, across all iterations)
- [NIT] tools/test-install.sh:274-275 - the comment quotes the red as one string, but the harness prints "expected, not added:" and the path on separate lines (iteration 1). DEFERRED: the meaning is exact, and a reword would re-run validation for a comment.
- [NIT] nothing automated exercises the new guard (iteration 1). DEFERRED: the harness sources libraries and checks for a live cut before it reaches the guard, so an isolated arm is costly. The reviewer agreed that skipping it is reasonable. The guard was proven by hand on Mortals (GUARD_RC=1, named FAIL line).

### Strengths (across all iterations)
- The root cause was found by instrumentation, not inference. Nothing named prompter-nudges existed anywhere under the sandbox, and the board log showed the failed roster read.
- The fix restores the control's ability to discriminate. On the 0.6.94 tree, a bundle missing kosmos-tunnel goes red in both the staged tree and the tarball, and the untouched arm is green.
- Full validation passed: yarn test ran 9079 tests with 0 failures, the build passed, and the subdir audit passed.
