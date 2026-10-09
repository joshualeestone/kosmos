---
pre_challenge: true
method: challenge-loop
branch: shellmini-4601
diff_hash: 94a21ce8154017e32b7d09a80d7e8853bc00dae80bed5e16ea651bb168f27ecc
validation: passed
subdir_audit: passed
timestamp: 2026-10-09T13:26:31Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (round 7: no BLOCKER, no CONVENTION; its one WARNING, that running shell shards on the mini is
argued in comments and not enforced, is the item deferred since round 2 with its reason in the plan, and its
remedy (write the precondition on #4601 where the variable gets set) was already done: the audit file list and the
precondition are posted on #4601. Its three NITs (a stale test header, an arm count, an evaluator's error wording)
were fixed in 171e0eb62's commit.)
**Reviewer models:** sonnet and opus alternating; round 7 opus, round 6 sonnet.
**Fixed:** every BLOCKER and actionable WARNING of rounds 1 to 6, each in its own commit.
**Deferred, with reason in the plan:** enforcement of the shell-on-mini precondition. The mechanism ships OFF
(KOSMOS_CI_SHELL_SHARDS unset), because a shell shard measured 14.0 min on the mini (#5488) and one Mac cannot
carry node plus a shard at peak; the real fix is a second self-hosted Mac, a hardware call.

Validation: bash tools/test-ci-runner-route-5488.sh, 0 failures on the rebased head. Red-checked by mutants:
dropping the $mac guard, removing the 2/2 case line, swapping shell1/shell2 in runs-on (the evaluator alone
reports "want S1, got S2"), removing the runs-on fallback ("no alternative chosen"), dropping set -f (the ?/?
arm), and removing the misspelt-value log line. Each went red; each was reverted with git checkout.

### Per-Iteration Breakdown

1: shard routing bypassed the own-code rule on one path; matrix/route mismatch: FIXED.
2: safety of shell tests on the mini only argued: DEFERRED (ships OFF, precondition stated where the var is read).
3: plan estimated a shard at ~6 min by ratio; #5488 measured 14 min: FIXED in the plan and corrected publicly on #4601.
4: fork PR and switch-off arms only on shard 1/2: FIXED (both shards).
5: substring shard match (1/2x routed); precondition named only "another Mac"; matrix names unpinned: FIXED.
6: tr parse untested on GNU; runs-on only pinned as text; misspelling silent in the log: FIXED (builtins + set -f, evaluator, log line).
7: deferred item re-raised (dedup); stale header, arm count, evaluator wording: FIXED.
