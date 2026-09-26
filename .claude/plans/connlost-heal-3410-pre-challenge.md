---
pre_challenge: true
method: challenge-loop
branch: connlost-heal-3410
diff_hash: 77a8bdb2577590e593ab7eaa5558aad785291881b2af256d02b51e247e2dbabf
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T21:00:25Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 13 reviewer findings (0 BLOCKERs, 12 WARNINGs, 1 CONVENTION) plus contention reds, and 20 NITs
**Fixed:** 12 | **Deferred:** 1 (documented as a known gap) | **Asked (awaiting user):** 0
**Validation:** final 6j run PASSED (8779 tests, 0 fail, audit clean). Earlier reds were contention: cli.msg-stdin-2909 (a killed CLI reads as exit 0 under load, filed #3628), feedbacksend timing, release-gate, and a run wedged by an OS exec stall (#3634). Each file passed alone, and three orphaned runaway feedguard processes that had been loading the box were killed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/status.js:2066 — a wrapped retry line would be missed --> FIXED (row glue, later removed as unreachable after measuring, iter 2)
- [WARNING] engine/status.js — reason text claimed a connection problem for any retry --> FIXED ("retrying a failed request")
- [WARNING] engine/status.js:2066 — `*` let a markdown bullet read as a live retry --> FIXED (dropped from the class)
- [NIT] misplaced comment; "real captures" overstated; "every attempt" title; control conflated two guards (all fixed)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 2 of the above
- [WARNING] engine/status.js:2074 — unconditional row-glue weaker than the auth rule's --> FIXED by measurement: at 80 columns Claude Code truncates the retry line and never wraps it, so the glue was removed
- [WARNING] engine/status.js:2071 — glue comment ignored capture-pane -J --> FIXED (removed with the glue)
- [NIT] evidence glyph handling (moot after removal)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/status.js:2068 — #874's second retry layout not covered --> FIXED then REMOVED at iter 5 (unmeasured under a network error, false-calm risk)
- [WARNING] engine/status.js:2063 — the `*` tradeoff not justified --> FIXED by measurement: all 152 frames were the static ✻ glyph at column 0
- [WARNING] engine/status.js:3880 — an indented prose row could read as a retry --> FIXED (column-0 anchor, indented control)
- [CONVENTION] engine/status.js:2062 — constant placed inside another's docblock --> FIXED
- [NIT] comment placement; captured vs composed fixtures; sampled-loop substitution check; "never wraps" overclaim (all fixed)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/status.connectionlost-3410.test.js:95 — CONTROL 2's composed spinner implied retries were already safe --> FIXED (marked composed, points at the captured case)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/status.js:2075 — the #874 layout matched anywhere in the tail, so a stale row made a wedged pane read working --> FIXED (layout dropped; a test pins that a stale row leaves connection_lost)
- [WARNING] engine/status.connlost-retry-3410.test.js:115 — the bullet control was indented, so it never tested the glyph class --> FIXED (column 0; a red control confirms it bites)
- [WARNING] engine/status.js:2074 — `*` frames and minutes-formatted delays are missed --> DEFERRED as a documented gap in the plan's Weakest premise (false-negative direction; PR 2b's persistence bound must absorb it)
- [NIT] header provenance; vacuous `because` assertion; plan naming; comment reflow (fixed)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs (its one WARNING duplicated the iteration 5 documented gap), 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/status.js:2066 | BRANCH | wrapped retry line missed | FIXED | e476313b, then measured unreachable f3e03afc |
| 2 | 1 | WARNING | engine/status.js | BRANCH | reason claimed a network cause | FIXED | e476313b |
| 3 | 1 | WARNING | engine/status.js:2066 | BRANCH | `*` bullet false match | FIXED | e476313b |
| 4 | 2 | WARNING | engine/status.js:2074 | SELF | unconditional glue | FIXED | f3e03afc |
| 5 | 2 | WARNING | engine/status.js:2071 | SELF | glue comment vs -J | FIXED | f3e03afc |
| 6 | 3 | WARNING | engine/status.js:2068 | BRANCH | second layout missing | FIXED, then removed | 04d3bdd9, 13a2b7d5 |
| 7 | 3 | WARNING | engine/status.js:2063 | SELF | `*` tradeoff unjustified | FIXED | 04d3bdd9 |
| 8 | 3 | WARNING | engine/status.js:3880 | BRANCH | indented prose row | FIXED | 04d3bdd9 |
| 9 | 3 | CONVENTION | engine/status.js:2062 | SELF | docblock placement | FIXED | 04d3bdd9 |
| 10 | 4 | WARNING | engine/status.connectionlost-3410.test.js:95 | BRANCH | stale CONTROL 2 premise | FIXED | cf4f2c05 |
| 11 | 5 | WARNING | engine/status.js:2075 | SELF | stale #874 row false calm | FIXED | 13a2b7d5 |
| 12 | 5 | WARNING | engine/status.connlost-retry-3410.test.js:115 | SELF | bullet control could not fail | FIXED | 13a2b7d5 |
| 13 | 5 | WARNING | engine/status.js:2074 | SELF | `*` frame / minutes delay missed | DEFERRED | documented gap, plan Weakest premise |

### NITs (non-blocking, across all iterations)
- [NIT] engine/status.connlost-retry-3410.test.js:79-94 — controls assert "not WORKING" rather than "is CONNECTION_LOST" (iteration 6)
- [NIT] .claude/plans/connlost-heal-3410.md:1 — "PR 2a" vs "PR 2" naming in code comments (iteration 6)
- [NIT] engine/status.js:3836 — uneven comment wrap (iteration 5)

### Strengths (across all iterations)
- The premise was measured, not asserted: a real captured retry sequence showed all 152 retrying seconds read connection_lost (iterations 1-6)
- Placement: below every working check, above connection_lost, below auth and rate-limit (iterations 1, 4, 5, 6)
- Every guard has a control that goes red when the guard is removed (iterations 1, 3, 5)
