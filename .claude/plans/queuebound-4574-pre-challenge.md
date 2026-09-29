---
pre_challenge: true
method: challenge-loop
branch: queuebound-4574
diff_hash: f212bc237d298701923d0a8afb22915eccc120375efc29e39106e3b8f30d39fa
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T19:28:34Z
iterations: 24
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 24 (opus and sonnet alternating; spawns on disk)
**Converged:** Yes (iteration 24: no finding that needed a change; its two WARNINGs deferred with reasons)
**Total findings:** 0 BLOCKER, 41 WARNING, 1 CONVENTION (one shared list, taken), NITs recorded per round in the plan
**Fixed:** 38 WARNINGs | **Deferred:** 3 WARNINGs (round 22: a test seam in test-install.sh; round 24: the PR text, and
an arm for a too-low first count) | **Asked (awaiting user):** 0
(Counted from the plan's "## Review iteration N" sections: WARNINGs from each round's header, plus round 24's two.)

**Final gate:** full validation PASSED on 305716fcc (the full tools/run-tests.sh validation v3, 14:12 to 14:28 CDT, VAL_RC=0 AUDIT_RC=0, validation-log hash f212bc237d29), run with KOSMOS_TESTS_IGNORE_SUITE=1 through the
jammed fleet queue (safe: run-tests.sh drops KOSMOS_WAIT_CONTROL_VARS before its tests). tools/test-cut-guard.sh:
0 failures, plain and with KOSMOS_NO_WAIT=1 inherited; every mechanism has a mutation control recorded in the plan.

**What the branch does (#4574, and the override half of #4609):** the #4498 suite queue ran one full suite per Mac and
each waiter gave up after 20 minutes in total while a suite takes 14 to 26, so every waiter second in line or later
ended with no validation. In the queue the bound (default 45 min) now counts from joining or from the last time a
waiter AHEAD left (read from one shared helper), with a hard ceiling of four bounds plus one per live waiter at entry.
Markers carry the start time in UTC/C on a new line 4 (line 3 kept for older copies of the lib), half-written .tmp
markers are skipped by name, a vanished own marker is re-marked with its old place, and run-tests.sh unsets the wait
controls and overrides (one list) before its tests so none is inherited. Waits outside the queue are unchanged.

### Per-Iteration Breakdown
- [WARNING] iteration 1 (opus, 3): first-line signal could flap; wall-clock arm untested; notice overstated --> FIXED
- [WARNING] iteration 2 (sonnet, 2): stale 1200 s header; helpers above the doc comment --> FIXED
- [WARNING] iteration 3 (opus, 2): 45 min covers claims and harnesses, unstated; a false sentence (SELF) --> FIXED
- [WARNING] iteration 4 (sonnet, 1): run-tests.sh comment overclaimed (SELF) --> FIXED
- [WARNING] iteration 5 (opus, 2): a failed ps deleted a live marker for good; stale test comment --> FIXED
- [WARNING] iteration 6 (sonnet, 2): clock seam under set -e; second-ask false fall --> FIXED (guard; documented)
- [WARNING] iteration 7 (opus, 1): churn behind unpinned --> FIXED (arm; counting all markers reds it)
- [WARNING] iteration 8 (sonnet, 3): give-up cause wrong; net-zero poll; re-mark time unobservable --> FIXED
- [WARNING] iteration 9 (opus, 2): reader zone/locale deleted live markers; hung-suite depth --> FIXED (UTC pin, ceiling)
- [WARNING] iteration 10 (sonnet, 2): older readers would delete new markers; which limit fired --> FIXED (line 3 kept)
- [WARNING] iteration 11 (opus, 2): empty start time read live; unexplained flake --> FIXED (stale; q_ready by name)
- iteration 12 (sonnet): NITs only (comments)
- [WARNING] iteration 13 (opus, 2): fixed ceiling ended healthy deep queues; fixtures in a shape no writer makes --> FIXED
- [WARNING] iteration 14 (sonnet, 2): stale "3 hours" text (SELF) --> FIXED
- [WARNING] iteration 15 (opus, 1): a missing own marker counted waiters behind --> FIXED (no count that pass)
- iteration 16 (sonnet): converged before the override fix
- [WARNING] iteration 17 (opus, 2): wait controls leaked into the queue tests (19 reds) --> FIXED (unset both layers)
- [WARNING] iteration 18 (sonnet, 2): unreadable safety rule; comment overclaim --> FIXED
- [WARNING] iteration 19 (opus, 3): third false-fall source; arm pinned 2 of 10 names; RT2 window --> FIXED (+ one list)
- [WARNING] iteration 20 (sonnet, 2): arm pinned 4 of 9 names; comment overclaim --> FIXED
- iteration 21 (opus): NITs only; one unsafe-side .tmp path match --> FIXED
- [WARNING] iteration 22 (sonnet, 2): healthy-queue overclaim --> FIXED; KOSMOS_WAIT_NOW in test-install --> DEFERRED
- [WARNING] iteration 23 (opus, 1): the ceiling does not cap the hung-suite wait (SELF) --> FIXED (cost stated)
- [WARNING] iteration 24 (sonnet, 2): PR text; an arm for a too-low first count --> DEFERRED
**Converged.**

### Deferred
Three WARNINGs, each with its reasoning in the plan (rounds 22 and 24).

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Weakest premise (from the plan)
That "a waiter ahead left" means the queue moved. The ceiling bounds a flapping signal. Behind a HUNG suite, the waiter
k deep gives up at about (k+1) bounds, longer than the old 20 minutes: stated and accepted.
