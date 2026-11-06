---
pre_challenge: true
method: challenge-loop
branch: fedkeep-8103
diff_hash: 520effb9da37b405caa6d8dfec9bf3eff1b63882cc9012539431eebb959e05fa
validation: clean on the final head (27526 tests, 0 fail, rc=0)
subdir_audit: not run (no CLAUDE.md under a changed path)
timestamp: 2026-11-06T10:42:06Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, sonnet, opus, sonnet). **Converged:** Yes: round 4, the whole-branch read, found three NITs, each judged not an issue on reading (deferred with reasons below).

**What it is:** #8103 (PigeonPete, measured on the #6746 test board). The board kept the newest 64 federation invite rows per project; the coordinator allows 100 live invites per account for 7 days, so 36 live invites could be neither listed nor withdrawn while counting against its cap. Trimming now never drops a live invite (no withdrawn_at, no member, an expiry in the future and no more than 30 days out); finished rows (used, withdrawn, expired) are still held to the newest 64.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the test's finished rows were only expired ones, so removing the used or withdrawn rule passed --> FIXED (a used and a withdrawn row added; removing either rule fails it, shown)
- [NIT] the comment overstated what bounds live rows --> FIXED
- [NIT] an expiry in milliseconds would read as live for ever --> FIXED (30-day bound)
- [NIT] clock skew --> DEFERRED: needs 64 newer finished rows and an invite within the skew of lapsing; members() uses the same clock

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] members() shows a malformed-expiry row as pending while the trim calls it finished --> DEFERRED with a comment: deliberate; the coordinator always sends a 7-day expiry, and a row it never sent must not grow the store without end
- [NIT] off-by-one fragile count, a stale snapshot read, plan missing the bound --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [NIT] the comment said a lapsed row is trimmed at the next invite --> FIXED (held to the 64 bound like any finished row)
- [NIT] the 30-day bound tested only with a huge value --> FIXED (31 days vs 7)
- [NIT] a joined member's row can still be pushed out, losing its label --> DEFERRED: unchanged from main, not this card; noted on #8103 as a possible follow-up

#### Iteration 4 (whole branch)
**Reviewer model:** sonnet
- [NIT] the bound is not pinned at exactly 30 days; a long line in the plan; one test covers four behaviours --> DEFERRED: the intent (a code lives 7 days, a later expiry is malformed) is what is pinned; cosmetic; each assertion message names its behaviour

### Controls
The new test fails on main (64 kept of 100; the oldest cannot be withdrawn). Removing the used and withdrawn rules from liveInvite fails it.
