---
pre_challenge: true
method: challenge-loop
branch: pifmargin-7619
diff_hash: f21c8cf06bf7dc44e31e626ea11c2b01322bdf545395bb04b65a1f65a7c31ebf
validation: focused (the branch's own test file 9/9 on the head rebased onto main 9cf6c3d426 (v0778), after the rebase; the full suite is CI's, on the exact head)
subdir_audit: not run (no subdir CLAUDE.md in the diff)
timestamp: 2026-10-31T17:42:54Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (capped at 8 by the fleet usage rule; round 8 returned no BLOCKER; its two WARNINGs were fixed and NOT re-reviewed)
**Converged:** Yes, at the cap (no round returned a BLOCKER after round 3's regression fix)
**Mutant:** the tool's kill replaced by a bare CONT (tools/prove-it-fails.sh:123), run on a copy of the final test: 7 red, 2 green
(the ordinary run and the colleague-edit arm, which do not depend on the kill), 0 sleep 300 or test processes left before or after.

### Rounds (the fix commit for each is in the branch log)
- 1 to 5: bounds for load, the 50 cap, a failed arm ends the tool's whole tree, real pids only, the runner recorded.
- 3: a real regression (an uncancelled race timer held the file 66 s), fixed at c198fed65f.
- 6: cleanups only on a failing arm (a passing arm could otherwise hit a reused pid); wait on 'close'; the runner checked
  gone; the pause cut from 20 s to 8 s.
- 7: a failing arm ends the tree as the signal landed; cleanup signals only sleep, node or bash; the ordinary arm has a timeout.
- 8: the forker checked gone and the list read again; the tree read in one ps (one pgrep per process let the signal
  land on a finished forker under load). Not re-reviewed.

### Left as NITs (not carded: none changes what the test can catch)
- A pid reused within seconds and still a sleep, node or bash could take a failing arm's TERM (start time not compared).
- A sleep forked between the forker's fork and its echo is not in the list (the tool's tree walk still ends it).
- The tool leaves its output temp file when a failing arm SIGKILLs it.
