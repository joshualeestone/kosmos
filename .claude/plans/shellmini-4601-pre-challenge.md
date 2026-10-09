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
argued in comments and not enforced, is the item deferred since round 4 with its reason in the plan, and its
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

### Per-Iteration Breakdown (from each round's commit subject)

1: the plan trusted an estimate (now measures: revert triggers, a skip-count comparison); spaces in the value; routing not logged; two more arms: FIXED (0394e1961).
2: the log could carry a workflow command (only shard characters kept); a stale node-only comment; three more arms: FIXED (56c6d6ac2).
3: the plan estimated a shard at ~6 min by ratio, #5488 measured 14 min on the mini: plan rewritten, mechanism ships OFF, corrected publicly on #4601; shell 2/2 gated arms; whitespace as separator; honest red-check record: FIXED (7b5d780f2).
4: the preconditions for setting KOSMOS_CI_SHELL_SHARDS not stated beside it: FIXED (590f7efea). Enforcement of them: DEFERRED (ships OFF).
5: substring shard match (1/2x routed); precondition named only another Mac; matrix names unpinned: FIXED (d4f9c3d02).
6: tr parse untested on GNU; runs-on only pinned as text; a misspelling silent in the log: FIXED (1919758ff, b105e4841).
7: the deferred enforcement item re-raised (dedup); stale header, arm count, evaluator wording NITs: FIXED (171e0eb62).
