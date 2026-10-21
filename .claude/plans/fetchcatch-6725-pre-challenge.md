---
method: challenge-loop
branch: fetchcatch-6725
diff_hash: abb69e7cdb89a1b66ab1396252efd4b6f36b9699e3d7f1233128b4418d39237b
timestamp: 2026-10-20T17:11:35Z
subdir_audit: passed
iterations: 6
converged: true
---

# Challenge-loop proof: fetchcatch-6725 (kosmos#6725: a request a reload cuts off is not a page error)

Six blind iterations (Opus, Sonnet, Opus, Sonnet, Opus, Sonnet). Iteration 6 returned no BLOCKER or WARNING.

## Iteration 1
[WARNING] arm 1 could pass with no rejection at all (now a WebKit precondition counts the rejection)
[WARNING] the ignore window ran to networkidle and would hide a real failure while the new page loads (now ends 250 ms after commit)
[NIT] the predicate copied into two files (pinned identical); stale "no beforeunload" comments (reworded)

## Iteration 2
[WARNING] the precondition counted any rejection (now only the held request's own promise)
[WARNING] a page error may land just after the commit (250 ms grace, its cost stated)
[NIT] own-origin CORS during a reload, bfcache (stated in Not covered)

## Iteration 3
[WARNING] nothing that runs guarded the one-second reset (arm 4 on one document; reset mutant red)
[NIT] a later beforeunload could be cut short (the timer is restarted); the predicate matched the address anywhere (anchored, two controls)

## Iteration 4
[WARNING] the precondition could itself flake (measured: held in 30 of 30 runs; arm 4 moved onto in-page timers)
[NIT] arm 3's label overstated what it pins (reworded)

## Iteration 5
[WARNING] arms 2 and 4 read page errors after fixed sleeps (now polled with a deadline); the stall residual stated
[NIT] the predicate's optional prefix and scheme (documented)

## Iteration 6
No new issues at WARNING or above.
[NIT] the header listed the arms out of order (fixed); lineOf returns '' on a reformat (left: the failure is loud)

## Evidence
- render-leaving-rejection-6725: all arms pass (12), repeatedly; mutants: the page rule removed (red on arms 1 and 4),
  the reset removed (red on arm 4's control). render-shell-noscroll-4872: 72 pass. The filter fired once (ignored=3).
