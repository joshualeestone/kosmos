---
pre_challenge: true
method: challenge-loop
branch: keepgrants-6817
diff_hash: 3416da1fdcc655fa0a7ef7f7423e718fe7f8d9a9d7e7539777f135ed552aef30
validation: passed (Mortals full suite, mortals-validate hash 3416da1fdcc6 at e8f7b31be5, after rebasing onto main f2822caad1 (#6825); browser-check surface gate GATE_RC=0 after the last web/ commit)
subdir_audit: passed
timestamp: 2026-10-21T15:45:30Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 returned NITs only)
**Total findings:** recorded with their decisions in `.claude/plans/keepgrants-6817.md` (decisions 4 to 8). Mona Lisa's design review folded in between rounds 3 and 4.

### Per-Iteration Breakdown

#### Iteration 1
- a review's Accept (re-accepting changed words) must keep the list; only a list with a finite time is kept --> fixed (decision 4)

#### Iteration 2
- two rare rebuilds (an unknown join settled, an undo) drop the kept list --> recorded with reasons (decision 5)

#### Iteration 3
- the design shot did not show the last-confirmed line --> fixed (decision 6)

#### Iteration 4
- design: the date folds into the heading; the sentence on what a reviewer is goes first --> fixed (decision 7)

#### Iteration 5
- NITs only (the date has no year, by design) --> converged (decision 8)
