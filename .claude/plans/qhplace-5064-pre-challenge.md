---
pre_challenge: true
method: challenge-loop
branch: qhplace-5064
diff_hash: d28b165d2b03657a8bc760a4b79c7149e2bd4410252c7eb79697a3ee3ff9fe72
validation: pending (mortals-validate on this exact head before merge; recorded on the PR). tools/test-queued-heavy-4977.sh 82 OK / 0 BAD on the rebased head.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-05T06:40:41Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviewers (1 Opus, 2 Sonnet), on the diff as stacked on queuewrap-4977 (90d07ad85).
The branch was then rebased onto main after #4977 merged as #5121; the three base files are byte-identical on main,
so the reviewed diff is the diff here.
**Converged:** Yes. Iteration 2 raised 0 BLOCKER, 0 WARNING (2 NIT, both taken).
**Fixed:** 1 WARNING, 5 NIT | **Deferred:** 1 NIT (stated)

### Per-Iteration Breakdown

#### Iteration 1 (Opus): 0 BLOCKER, 1 WARNING, 4 NIT
- [WARNING] the test released the box after a fixed 2.5 s, so a slow waiter could turn the CONTROL red for the wrong reason --> FIXED (waits until both waiters hold a marker)
- [NIT] message wording "re-marked its place" --> FIXED
- [NIT] stale comment about a main-lane loser leaving the queue --> FIXED
- [NIT] a 170-character comment line --> FIXED
- [NIT] QH_JOINED taken a few seconds before the library's join time --> DEFERRED (a few-second tie, no starvation; identical to the installed copy)
- Verified: parity with the installed copy line for line; mutants (re-mark writes now, seam off) turn the arms red; the arm passed 15 of 15 in a loop.

#### Iteration 2 (Sonnet): 0 BLOCKER, 0 WARNING, 2 NIT
- [NIT] a timed-out wait for the waiters is written into the order file, so the ORDER= arms go red instead of passing a run that never raced --> FIXED
- [NIT] both waits count exactly the lib's suitewait.<pid> markers --> FIXED
