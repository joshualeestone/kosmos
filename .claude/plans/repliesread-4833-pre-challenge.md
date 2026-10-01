---
pre_challenge: true
method: challenge-loop
branch: repliesread-4833
diff_hash: 79d69ec8162513e8215aa154301b399f11175928900998c03e8b929c5fbd6b6a
validation: focused at this head on origin/main 75660adf3: every community, CLI and server test file that touches the community read or following, plus server.test.js and the file-scanning guards (fixture-discipline, the #4796 guard, no-brand-refs, no-name-refs), 1,548 pass, 0 fail; CI runs the full suite on the merge ref
subdir_audit: passed
timestamp: 2026-10-01T09:37:47Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 blind rounds, 2026-10-01 (round 7 with a model checker of 1,900 simulated runs)
**Converged:** Yes (round 9: no blocker, no should-fix)
**Findings:** 1 BLOCKER (round 3), about 20 SHOULD-FIX across rounds 1 to 8, all taken. Full record in `.claude/plans/commentsread-4833.md` ("Slice 2 review").

### Iteration 1: 0 BLOCKER, 5 SHOULD-FIX
- [SHOULD-FIX] twins could read each other's replies (safeKey match) --> FIXED: exact owner match, lossless mark key
- [SHOULD-FIX] replies after the 2nd preview never read --> FIXED: the service's replies cursor
- [SHOULD-FIX] a future mark hid everything; route untested; reply-body quoting untested --> FIXED

### Iteration 2: 0 BLOCKER, 5 SHOULD-FIX
- [SHOULD-FIX] holding the mark on long threads jammed it forever --> FIXED: the read says what it cannot carry; the mark moves
- [SHOULD-FIX] no output cap; taken-down posts jammed the mark; stated limits; untested branches --> FIXED (oldest-first cap 30)

### Iteration 3: 1 BLOCKER, 3 SHOULD-FIX
- [BLOCKER] a burst inside the 60 s overlap was shown again forever --> FIXED: position marks (time, id), per post
- [SHOULD-FIX] one failing post froze all; silent 10-post limit; untested safeguards --> FIXED

### Iteration 4: 0 BLOCKER, 3 SHOULD-FIX
- [SHOULD-FIX] the overlap re-showed replies within a minute; marks mixed the board's and the service's clocks; id tie-break untested --> FIXED: marks in the service's own time

### Iteration 5: 0 BLOCKER, 3 SHOULD-FIX
- [SHOULD-FIX] a comment landing between the two fetch rounds was skipped --> FIXED: round-1 mark plus a seen list
- [SHOULD-FIX] failed reply page untested; service load (one read per board now) --> FIXED

### Iteration 6: 0 BLOCKER, 3 SHOULD-FIX
- [SHOULD-FIX] a cut cleared seen (repeat) and could skip a between-rounds comment --> FIXED: one mark rule for cut and full reads

### Iteration 7: 0 BLOCKER, 2 SHOULD-FIX
- [SHOULD-FIX] the 7-day first look leaked on the second read; an untested guard --> FIXED: the window as the floor

### Iteration 8: 0 BLOCKER, 1 SHOULD-FIX
- [SHOULD-FIX] a post with no mark (empty, held back, unreachable) was judged against a later window --> FIXED: every such post takes the floor

### Iteration 9: 0 BLOCKER, 0 SHOULD-FIX (CONVERGED)
- [NIT] a gone-and-back post stated; a held-back post tested; a test title and two plan lines made true --> FIXED
