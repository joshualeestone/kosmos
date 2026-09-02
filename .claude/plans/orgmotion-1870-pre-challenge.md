---
pre_challenge: true
method: challenge-loop
branch: orgmotion-1870
diff_hash: 301f334069a9772c388305ec6f82be0e935d577198df2fe7a2508fe1dcb7b8e1
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T18:48:50Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 produced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 4 (0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 2 | **Deferred:** 2 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] .claude/plans/orgmotion-1870.md - 10 literal em dashes in the plan file (org no-em-dash rule) --> FIXED (commit 71599714)
- [NIT] docs/browser-checks/render-org-reduced-motion.js:37 - DISC_MIN=44 used as both overlap threshold and assumed diameter, but measured faceW never asserted equal to it (silent drift if disc CSS resizes) --> FIXED (commit 71599714): added an assertion that the rendered .face is 44px
- [NIT] docs/browser-checks/render-org-reduced-motion.js:100 - minC >= DISC_MIN is redundant with pairs === 0 --> DEFERRED: intentional belt-and-suspenders, and it prints the diagnostic px in the message; reviewer flagged it as a note, not a fix request

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged** - no new actionable findings.
- [NIT] docs/browser-checks/render-org-reduced-motion.js:70-72 - DENSE_MAX=64 couples to ORG_SIM.minGap (52); if that floor were raised above 64 the arm would false-red --> DEFERRED: intentional per the comment (forces re-derivation), reds toward a look rather than hiding a bug; 12px margin below 64 and it is deterministic, not flaky
- [NIT] docs/browser-checks/render-org-reduced-motion.js:96 - the `worst` array collects the first up-to-6 overlapping pairs in iteration order, not the 6 tightest --> DEFERRED: informational only (used just in the FAIL message; the true minimum is tracked separately in minC and is what is asserted), no correctness impact

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/orgmotion-1870.md | em dashes in plan file | FIXED | 71599714 |
| 2 | 1 | NIT | render-org-reduced-motion.js:37 | disc diameter assumption unpinned | FIXED | 71599714 |
| 3 | 1 | NIT | render-org-reduced-motion.js:100 | redundant minC>=DISC_MIN | DEFERRED | intentional diagnostic |
| 4 | 2 | NIT | render-org-reduced-motion.js:70 | DENSE_MAX couples to minGap | DEFERRED | intentional, reds toward a look |
| 5 | 2 | NIT | render-org-reduced-motion.js:96 | `worst` is a sample, not the tightest | DEFERRED | informational only, no correctness impact |

### NITs (non-blocking, across all iterations)
- [NIT] render-org-reduced-motion.js:100 - redundant minC>=DISC_MIN (iteration 1, kept as diagnostic)
- [NIT] render-org-reduced-motion.js:70 - DENSE_MAX/minGap coupling (iteration 2, intentional)
- [NIT] render-org-reduced-motion.js:96 - `worst` sample naming (iteration 2, informational)

### Strengths (across all iterations)
- Non-vacuity guarded two independent ways: measured perturbation (revert orgLiveSettle -> 7 overlapping pairs, 33px) AND an in-check density floor that reds a flattened fixture (iterations 1 and 2, both confirmed the mechanism holds and fails safe)
- The dense board is correctly scoped as its own boot_board_org so render-org-chart's node-count-keyed fill-band is untouched; a denser write_fleet_rich would have reddened that sibling (iterations 1 and 2)
- Reduced-motion emulated at the context (newContext reducedMotion:'reduce') so it reaches matchMedia and drives orgLiveStart's synchronous-settle branch, the exact #1738 path; overlap measured on .face centres not the callout-inflated .onode box (iterations 1 and 2)
- Fixture reconciliation verified end to end: panes seeded as name-discord, stripped to sessionName, profile read by stripped name, orgTreeOf keys byName on sessionName, so the reportsTo tree genuinely builds and static orgPlace overlaps (iteration 2)
- All three wiring guards reconciled: run_one in browser-checks.sh, README row (indexed test), EXPECTED_BOOTS 7->8 with dry-run set; EXPECTED_SITES=28 correctly unchanged; bash 3.2-safe fixture seeded in node (iterations 1 and 2)

### Validation
- Full suite (bash tools/run-tests.sh) run to completion untimed at baseline and again as the 6j closing gate: node --test 3751 tests, 0 fail; all shell arms pass ("ALL PASS"). The in-tool 120s SIGTERM seen mid-loop was a Bash-tool timeout on a long suite, not a real red - disproven by the untimed runs.
- The four browser-check guards pass: browser-checks-indexed, browser-checks-selectors, browser-checks-reason-grep, tools.browser-checks-wired.
- web/index.html untouched; org-reduced-motion-settle-1738.test.js (the #1738 node test) still 3/3.
