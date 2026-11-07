---
pre_challenge: true
method: challenge-loop
branch: iosheld-8146
diff_hash: ec71732db68ba488cd0c0158177dad5b578abba69e18fc2272082d88a4cf00ff
validation: passed
subdir_audit: passed
timestamp: 2026-11-07T00:31:26Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (round 1, whole branch: 0 BLOCKERs, 0 WARNINGs, 1 NIT)
**Fixed:** 0 | **Deferred:** 0 | **Left:** 1 NIT

Validation (local): ios/LogicTests/run-taskpage.sh PASS 116/116 (the only logic suite that compiles TaskPageLogic.swift).
Mutation: the app sources copied with the old status line put back give FAIL 2 of 116 (both held arms), measured.

### Iteration 1 (opus, whole branch)
- [NIT] `as? Bool == true` would accept a stored 1 where the board's `=== true` would not: the engine never stores a number there, and the neighbouring fields read it the same way. Left.

**What round 1 checked and found sound:**
- The Swift order matches web/index.html tkPaintSubtasks: Done/Replaced, Built, On hold, Open.
- Swift built() and the board's built() both leave held out (closed, onHold, builtAt).
- isClosed reads progress.closed, else closedAt, as the board's done() does.
- TaskPageView.swift compares the status word only to "Built" (its colour); "On hold" gets the secondary grey, as every status word on the board does.
- The accessibility label reads the word, so VoiceOver says "On hold" (reasoned, not heard).
- No switch, icon or done styling keys on the status text; the all-done and all-built lines use isClosed and built() directly.
- The test variant is built from the captured engine read, not hand-written; a failed rebuild returns empty data and turns all four arms red together.
- Each arm can fail: the open arm on the old "Open", the built arm if built() stopped leaving held out, the closed arm if the held check moved ahead of the closed check.
