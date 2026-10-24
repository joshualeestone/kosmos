---
pre_challenge: true
method: challenge-loop
branch: faildeliver-6720
diff_hash: 6add834b7c5801d67016c01164b6daf30a436f6f9cd46c5e3abb9b0d24ba5f48
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T08:47:56Z
iterations: 5
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind rounds on the original branch (opus, sonnet, opus, sonnet), converged at round 4; then, after the rebase onto main and the merge with #6774 (2026-10-24), a 5th blind delta review of that merge (opus): 1 BLOCKER, 1 WARNING, 1 NIT, the BLOCKER and WARNING fixed with tests, NOT re-reviewed. **Converged: no**, for that reason. Every finding is in
.claude/plans/faildeliver-6720.md. The hard rule throughout: a message must never be sent twice.

**Validation of THIS diff:** the Mortals full suite on head 86b564ee9f: **23660 tests, 0 failed** (hash 6add834b7c58, the diff this proof hashes). Earlier runs tonight: 433b0bbdaf failed only the surface gate (the squash had dropped the per-check trailers; all 17 checks re-run and passed, trailers in 6b1ce11283), and 6b1ce11283 passed 23657/0 before the delta review.

**Validation of the original branch, stated exactly.** Validation 1 (956795c5): 2 failures, both mine (the retryable check called a helper
that starts link-preview fetches; the new browser check was not wired). Fixed. Validation 2 (e06eeb3e, tree
untouched, AUDIT_RC 0): 22537 tests, 2 failures, both the same line of mine (the gated list entry carried .js); fixed
in one line, and tools.browser-checks-wired.test.js passes 11/11 alone. diff_hash computed, never typed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] the being-sent-again mark lived in memory, written after typing: a crash or failed write could retry twice --> FIXED (durable mark BEFORE any key; finish writes over it)
- [WARNING] old failed rows offered retry --> FIXED (retryable marked at append)
- [WARNING] an old row retried out of order --> FIXED (newest only)
- [WARNING] every non-placed result announced as failed --> FIXED
- [WARNING] refusal only in a tooltip --> FIXED (said under the box)
- [WARNING] no menu-refusal test --> ADDED
- [NIT] four nits --> three fixed, one recorded

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] a throw after begin left "may have arrived" --> FIXED (finished as may or may not have arrived)
- [WARNING] newest checked before awaits --> FIXED (under the lock)
- [WARNING] box copy dropped for any kept row; a masked row could never retry --> FIXED (retryable answer; masked rows not marked)
- [NIT] three nits --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a retry in flight redrew as a warning on the poll --> FIXED (pressed button while in flight here)
- [NIT] two nits --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- No double-send or loss path. Three nits, not changed with reasons. Converged.
