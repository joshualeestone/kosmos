---
pre_challenge: true
method: challenge-loop
branch: tabcenter-2624
diff_hash: ed3ccb52b5a862eecd9a8b289368d3f93352a4e7689fd8dc8add4169a3b1f238
validation: passed
subdir_audit: passed
timestamp: 2026-10-05T01:41:36Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes
**Total findings:** 9 (1 BLOCKER, 7 WARNINGs, 1 CONVENTION)
**Fixed:** 6 | **Deferred:** 3 | **Asked (awaiting user):** 0

Validation on the exact head 6d4439a56 (rebased onto main 2026-10-04 12:1x, after main changed web/index.html):
- Full validation on Mortals through validation-log: 15052 tests, 0 fail, 0 cancelled, status clean (a real run).
  Hash ed3ccb52b5a8, matching this proof.
- FULL tools/browser-checks.sh: 316 checks, all page checks passed, 0 FAIL lines, EXIT 0. render-tophead-stable-2624: OK.
- Earlier, on the pre-rebase head 9b12ba791: the same two runs green; mutation (the header's old flex rule) reds the
  check with "move 90.5px"; web.layout-picker 13/13.
- Merged onto current main without a re-run under Splinter's 19:29 ruling; the overlap evidence (including a
  touch-emulated run of the check on the merged tree) is on the PR.

Design: Mona Lisa approved 10-02 17:44; later commits change no rendered pixel (measured).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] index.html: a comment said "same grid" but the gap was 12px vs 24 --> FIXED
- NITs (flex-start leftover, wording, a 960 arm, plan widths) --> fixed

#### Iteration 2 (sonnet)
- [WARNING] index.html: two literal 24px values --> FIXED: the rule sets no display, columns or gap and inherits
- NITs --> fixed or accepted

#### Iteration 3 (opus)
- [CONVENTION] plan said "gap unchanged", contradicting the diff --> FIXED
- NITs (mutation count re-measured to 6, long rows printed) --> fixed

#### Iteration 4 (sonnet)
- [WARNING] overflow or clipping at 960 not asserted --> DEFERRED: measured with a 581px switcher, the grid keeps its
  gaps and never overflows; a squeeze shows as the tabs moving, which the moved-with-name arm already catches

#### Iteration 5 (opus)
- [WARNING] the check compared only tops --> FIXED: x positions too (a 40px padding mutation reds it)

#### Iteration 6 (sonnet)
- [WARNING] names over 220px and large text not measured --> DEFERRED, with the measured limit stated in the plan

#### Iteration 7 (opus)
- [BLOCKER] web.layout-picker.test.js pinned display:flex --> FIXED: pins no display plus the grid rule (a flex mutation
  reds it)
- [WARNING] the large-text 56rem override --> DEFERRED: matches the tab view

#### Iteration 8 (sonnet)
- 0 new BLOCKER, WARNING or CONVENTION (its one WARNING duplicates iteration 6's deferral) --> CONVERGED
