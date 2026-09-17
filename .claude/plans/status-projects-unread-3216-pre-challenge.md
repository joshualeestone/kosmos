---
pre_challenge: true
method: challenge-loop
branch: status-projects-unread-3216
diff_hash: cb54ed08f469fe450cd7a7a5a9b561e37394f42093e1b84bb170fca13ad52f2b
validation: passed
subdir_audit: passed
timestamp: 2026-09-17T16:55:51Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes
**Total findings:** 2 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Fixed:** 0 | **Deferred:** 2 (NITs) | **Asked:** 0

Small, well-scoped engine change (add projectsUnread to /api/status counts). Iteration 1 (opus)
returned zero actionable findings after verifying the load-bearing claims against source. Single
model witnessed convergence, which 6d permits on a first zero-actionable pass; noted as the weaker
case (kosmos#2032) for a change this small and this thoroughly source-verified.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty; 6.0 passed clean)
- [NIT] server.js / plan -- the perf comment "both already paid by the projects poll" understates that on a non-Projects tab the projects poll is visibility-gated OFF, so /api/status newly pays the readAll + unreadAll pass there. Still small (one small-file read, one single record pass, only while the dashboard is open) --> DEFERRED: accurate that the cost is new on those tabs, but genuinely small and the plan's Perf note already flags the memoize-if-heavy path; not worth churning the diff for a comment softening.
- [NIT] test -- no explicit test for the deleted-project edge (an unreadMap key absent from projects) --> DEFERRED: structurally guaranteed (the sum iterates readAll projects, never the map keys, so an extra key cannot over-count) and opus confirmed it; the inverse (project with no map entry -> 0) IS covered. A 1-line case would guard a future map-key-iteration refactor; recorded as a cheap follow-up, not required.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | NIT | server.js:3356 | BRANCH | perf comment understates new cost on non-Projects tabs | DEFERRED | small, plan flags memoize path |
| 2 | 1 | NIT | status.projects-unread-3216.test.js | BRANCH | no explicit deleted-project-edge test | DEFERRED | structurally guaranteed, opus-confirmed |

### Outstanding questions (ASKED)
None.

### Strengths (iteration 1, opus, verified against source)
- One-derivation holds: projectsUnreadTotal(readAll(), unreadAll()) and the client pjDmTotal look up the SAME messages.unreadAll() map by the SAME id key (withUnread server.js:2264 sets p.unread=counts[p.id]; describe spreads ...project so the id is the raw readAll id); list()=readAll().map(describe) 1:1 no drop, so the non-archived sets match row-for-row (sub-projects included); finite>0 matches; PJ_CURRENT exclusion correctly left to the client (option i).
- archived predicate exact match: describe normalizes archived===true, server guards archived===true, so a truthy-but-not-true legacy value classifies identically on both sides.
- Never 500s, field always present: readAll throws UNREADABLE and unreadAll returns null on unreadable, both folded to 0 (try/catch on the wire + null-guard in the pure fn); projectsUnreadTotal is total and cannot throw.
- Deleted-project edge correct: a key in unreadAll absent from readAll is excluded (the loop iterates readAll, never the map keys), matching the client active-set behavior.
- No web/ change, so the browser-check gate chain correctly does not fire; no em dashes on added lines; counts is a plain mutable object with no fixed-shape consumer, so the additive field is safe; 9 unit tests present.
