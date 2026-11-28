---
pre_challenge: true
method: challenge-loop
branch: reportkeeps-9320
diff_hash: b3f0c66a7e6d241c4474febdcadd54da2a09baaaa6f10e54711f56a53f81c31a
validation: on 1e69c0fbe4 (the commits after it change only the plan): the 159 test files naming selfreport or /api/report, through queued-heavy.sh, 3195 tests, 0 fail, 31 skipped; server.replacedquestion-9320 4/4 three times. Mutants: the route line removed reds 2, record()'s check removed reds 3, the old slice cut reds the escape test. The full suite runs on the PR's CI.
subdir_audit: not run (no CLAUDE.md in the diff)
timestamp: 2026-11-28T16:49:47Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes. Iteration 2 found no BLOCKER or WARNING; its two NITs are below, not applied.

Measured arms:
- a blocked report with no question standing: no such note (control); over a question: the note, naming it, and the report still lands
- clear over a question, and replacing an automatic permission prompt: no note
- each of the three mutants above: red

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] the note cut by a plain slice and kept control characters, so a split emoji or a control character reached the reply as a JSON escape the macOS CLI prints --> FIXED: control characters become spaces, the cut uses cutUnits; a test covers both, and the old cut reds it
- [NIT] operator clears (#2575, #5034) did an unused read --> FIXED: entry.by === 'operator' skips it
- [STRENGTH] the read never runs on the hook's hot path (auto writes skip it)
- [STRENGTH] notes combine correctly; no test pins the bare { recorded: true } reply in a case that now differs

#### Iteration 2
- [STRENGTH] cutUnits (engine/textcut.js) drops a trailing lead surrogate and counts the same units as the length test
- [STRENGTH] the operator exclusion is right for both writers, and an agent cannot set by:'operator' through /api/report
- [STRENGTH] the new read runs after the #900 guard and never with it (disjoint conditions)
- [NIT] a concurrent report between the read and the append can make the note name a question already gone --> not applied: the note is advice, and the state stays right (the same race the #900 guard has)
- [NIT] the route already reads the prior state, so record() reads it twice --> not applied: one extra tail read on an agent-typed report, not on the hook path
