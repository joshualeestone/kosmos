---
pre_challenge: true
method: challenge-loop
branch: faildeliver-6720
diff_hash: d4371c586e067241997acffda683e41d5e6e8283ea2c5f042efc2d59d5fcbb54
validation: passed-after-a-one-line-list-fix-rerun-targeted
subdir_audit: passed
timestamp: 2026-10-20T21:02:57Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind rounds (opus, sonnet, opus, sonnet), converged at round 4. Every finding is in
.claude/plans/faildeliver-6720.md. The hard rule throughout: a message must never be sent twice.

**Validation, stated exactly.** Validation 1 (956795c5): 2 failures, both mine (the retryable check called a helper
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
