---
pre_challenge: true
method: challenge-loop
branch: runninganchor-5470
diff_hash: cbecbbde14b9fd9dd83ae950f1155152a6d15236d282f8ceeb67402180609182
validation: pending (the Mortals full suite queue is jammed: two sibling runs gave up after ~3.6 h at 09:16, not test results; this PR's GitHub CI, which runs the full node and shell suites on macOS, is the validation, and this line is updated when it reports. Run by hand on this head: test-running-anchor-5470 0 failures, tools.heavy-gate-3805.test.js 46 pass, test-cut-guard 0 failures, test-light-side-4911 0 failures, test-queued-heavy-4977 93/93, test-browser-gate-cut-claim-1398 pass, and test-browser-run-guard with its real-path control KOSMOS_BC_REALPATH=1)
subdir_audit: passed
timestamp: 2026-10-07T14:33:00Z
iterations: 15
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 15, reviewer models alternated (opus, sonnet)
**Converged:** Yes (iteration 15: NITs only)
**Fixed:** every actionable finding, one commit per iteration ("address challenge-loop iteration N findings")
**Deferred:** see below | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] tools/heavy-gate.sh read a queued-heavy waiter as a running browser check (the #5467 deadlock, still open there) --> FIXED: waiter carve-out
- [WARNING] the test's "mention" arm was vacuous (bash exec'd sleep) --> FIXED
- [WARNING] three more hand-written anchors in cut-guard.sh (release, test-install, run-tests) --> FIXED: all through kosmos_running_lines

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] value-taking shell options (-o NAME, --rcfile FILE) read as not running --> FIXED
- [WARNING] a waiter under a spaced checkout path slipped the carve-out --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] +x and a bare -- missed --> FIXED
- [WARNING] the carve-out fired on any word, hiding a script's heavy argument --> FIXED: first .sh word only
- [WARNING] spaced script paths not seen --> DEFERRED (documented; the replaced guards had the same gap)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] option letter RANGES are locale-dependent --> FIXED: LC_ALL=C

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] agents run the INSTALLED ~/.cache/claude-handoffs/queued-heavy.sh, which the tools/-only carve-out still counted --> FIXED: any directory
- [WARNING] merged is not in effect until the Mortals checkouts are pulled --> FIXED: stated in the plan

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] runs started from inside tools/ are not seen; set -e calling contract not stated at the helper --> FIXED: both documented

#### Iteration 7
**Reviewer model:** opus
- [WARNING] a non-.sh wrapper passing queued-heavy.sh hid the heavy path after it --> FIXED: LEAD script only

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] a wrapper's tools/queued-heavy.sh argument read as a split-path tail --> FIXED: absolute non-.sh lead and a two-segment tail
- [WARNING] the waiter-to-run window --> FIXED: documented

#### Iteration 9
**Reviewer model:** opus
- [WARNING] a checkout path split at two or more spaces --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] split-path text ambiguity, both directions --> DEFERRED (see below)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] heavy-gate's operator header did not list the waiter --> FIXED

#### Iteration 12
**Reviewer model:** sonnet
- [WARNING] the fixture filter read option-bearing lines differently from the helper --> FIXED: shared _KOSMOS_SH_OPTS, spelled-out letters

#### Iteration 13
**Reviewer model:** opus
- [WARNING] the fixture-filter test checked a copy of the regex --> FIXED: runs the real function (red with the group index reverted)
- [WARNING] test-cut-guard.sh skip predicates still hand-wrote the old pattern --> FIXED

#### Iteration 14
**Reviewer model:** sonnet
- [WARNING] the comment claimed a waiter's claim covered its queued wait (false) --> FIXED: reworded
- [WARNING] split-path ambiguity --> DEFERRED (duplicate of 10)

#### Iteration 15
**Reviewer model:** opus
**New findings:** NITs only. **Converged.**

### Deferred, with reasons
- From text alone, the tail of a path that ps split at a space cannot be told from a relative argument: a split path with ONE segment before queued-heavy.sh reads as a run (fails toward busy), and `/wrapper a/b/queued-heavy.sh` reads as a waiter. Every tightening trades one for the other; nothing in the fleet runs either.
- kosmos_running_lines misses runs started from inside tools/ and spaced script paths (the replaced guards had the same gaps; the cut and page layer always start as tools/...).
- heavy-gate labels a waiter "mentions the name"; the verdict (not counted) is right.

### Strengths
- [STRENGTH] Five hand-written "is X running" matches, with two patterns, are one helper with the same 0/1/2 contract; the wider interpreter only adds candidates (fails toward busy).
- [STRENGTH] Tests use real processes with a unique script name and a control that the unanchored pgrep DOES match each non-run shape; measured red with the anchor removed (3 failures).
