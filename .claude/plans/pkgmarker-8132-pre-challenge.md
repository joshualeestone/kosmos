---
pre_challenge: true
method: challenge-loop
branch: pkgmarker-8132
diff_hash: b4e7b4f4f64dfb4b0bfddc2639a4d143c5cf4616623935f600a45b16c257ae26
validation: passed
subdir_audit: passed
timestamp: 2026-11-06T22:32:22Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (round 7 found NITs only; rounds 2 and 3 also found only NITs, taken with a further round each
because one was a false statement in a file this branch edits)
**Total findings:** 6 actionable (0 BLOCKERs, 6 WARNINGs, 0 CONVENTIONs), 22 NITs
**Fixed:** 6 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation (local; the full suite queue runs on Mortals, and the PR's CI is the remaining gate):
- The new guard on main's markers fails, naming the dead sentence; on this branch it passes.
- Served, real: check-served.js with the new marker against installkosmos.com, rc 0, the pkg row ok.
- Served, negative: a re-flattened copy of the served pkg without the sentence, behind a local mirror (a scratch copy
  of check-served.js using node:http): the row FAILs (rc 1); the same harness passes the real pkg (rc 0).
- After merging origin/main: the static guard set plus the touched files, 3843/3843; the surface gate passes.
- Every other marker in served-markers.json passes against served 0.7.94.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools.served-markers-sources-8132.test.js:30 — raw sources let a marker found only in a comment pass --> FIXED (0bb02b7a66: stripped sources, a comment-only control)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs (one a false _cannot_see note; all taken, 3f3b9c39bb)
**Self-generated:** 0 of the above

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs (taken, with the same stale claim in web.ruling-guards, 196d96309c)
**Self-generated:** 0 of the above

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (my round-3 comment)
- [WARNING] web.ruling-guards.test.js:254 — "guarded at ship time" overclaimed (nothing runs check-served) --> FIXED (0ed4095e38: pointers to the real checks)
- [WARNING] web.ruling-guards.test.js:258 — the merge-time pin in install.installing-page.test.js was not named --> FIXED (0ed4095e38)
- [WARNING] install.installing-page.test.js:203 — a third copy of the stale claim --> FIXED (0ed4095e38)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] tools.served-markers-sources-8132.test.js:44 — the strip check compared text, fragile and misleading --> FIXED (72625e45e0: compared by behaviour)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (my round-5 sample)
- [WARNING] tools.served-markers-sources-8132.test.js:47 — one comment of each kind could not tell greedy from lazy --> FIXED (e61b2d674d: two of each; a greedy check-served copy turns it red)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools.served-markers-sources-8132.test.js:30 | BRANCH | Comment-only markers passed | FIXED | 0bb02b7a66 |
| 2 | 4 | WARNING | web.ruling-guards.test.js:254 | SELF | "guarded at ship time" overclaim | FIXED | 0ed4095e38 |
| 3 | 4 | WARNING | web.ruling-guards.test.js:258 | BRANCH | Merge-time pin not named | FIXED | 0ed4095e38 |
| 4 | 4 | WARNING | install.installing-page.test.js:203 | BRANCH | Third stale copy | FIXED | 0ed4095e38 |
| 5 | 5 | WARNING | tools.served-markers-sources-8132.test.js:44 | BRANCH | Text-compared strip | FIXED | 72625e45e0 |
| 6 | 6 | WARNING | tools.served-markers-sources-8132.test.js:47 | SELF | Sample too weak for greedy | FIXED | e61b2d674d |

### NITs (non-blocking, across all iterations)
- Order markers checked for presence only (web.ruling-guards holds order)
- The web/index.html side of check-served's strip (codeOnly) is not held by the parity check; the pkg arm's is
- The marker is the #hint line, hidden at finish: the row checks text shipped, not seen
- Long _cannot_see note (JSON cannot break lines)

### Strengths (across all iterations)
- The new marker is live markup, already pinned by install.installing-page.test.js
- Every assertion has a floor or a control that can say no, including commented-only sentences on both sides
- The guard reads check-served.js's PAGES list and strip, so drift turns it red
