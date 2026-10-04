---
pre_challenge: true
method: challenge-loop
branch: gatesnap-5247
diff_hash: 169e05b9c94869a73a6e4cf3d6a2a8660c6922e15b85755a9c4f6aeb15ca8056
validation: passed (D3: server.js gate + its test; focused 81 related files + every file-scanning guard: 1164 pass, 0 fail, 4 skipped pre-existing); a full suite before the after-Monday merge
subdir_audit: passed
timestamp: 2026-10-04T11:15:19Z
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
