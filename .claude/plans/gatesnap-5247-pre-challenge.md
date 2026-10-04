---
pre_challenge: true
method: challenge-loop
branch: gatesnap-5247
diff_hash: 71fedda0df5e7acb6d4b72145e02d9ba9e91cd1ef52e6eb7108ad1eac05db8e0
validation: passed (Mortals full suite at e137a722e, 07:32 CDT 2026-10-04: 15018 tests, 14794 pass, 0 fail, 224 skipped; hash 71fedda0df5e; full suite passed on Mortals)
subdir_audit: passed
timestamp: 2026-10-04T12:42:04Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (opus, fresh blind security reviewer)
**Converged:** Yes (no BLOCKER; 1 WARNING fixed, 1 NIT fixed)
**Fixed:** 1 WARNING + 1 NIT | **Deferred:** 0 | **Asked (awaiting user):** 0

#5247: the board gate accepts another world's token only as it was when the board started, for a world it knew then
or created itself; hiding a world still narrows. Hardening after #4491 / PR #5122 (Ice Cream Kitty's option B).

## Round 1 (opus): 0 BLOCKERs, 1 WARNING, 1 NIT
- [WARNING] the snapshot froze world ids but still read their token VALUES from disk per request, so a token file
  written after start (e.g. for a world the board made, before it ever booted) was accepted: FIXED, tokens are
  snapshotted at start; a board-made world is recorded with no token. New test (token overwritten after start:
  refused; start-time token still accepted) + mutant (disk read restored) turns three tests red.
- [NIT] the hidden-world 403 relied on an earlier test's control: FIXED, its own positive control first.
- Checked clean: #3055 post-switch (the switch restarts the board as a new process, whose snapshot holds the world it
  left); snapshot before listen; unreadable registry = active token only; default world always present; the create
  route is the only createWorld caller; a hidden id cannot be re-added; knowWorld reachable only from tests; no em dash.

## Weakest premise
That no other world's board can be running and rotate its token while this board runs (one board per account; a
switch restarts). If one did, its new token gets a 403 here until this board restarts: the safe direction.
