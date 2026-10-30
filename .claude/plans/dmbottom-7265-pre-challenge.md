---
pre_challenge: true
method: challenge-loop
branch: dmbottom-7265
diff_hash: f0893f64c3b6124daac7e7ffa9cb98d52a4a8f0f020391b74a5c2845a8108bd2
validation: passed
subdir_audit: passed
timestamp: 2026-10-27T07:36:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind review rounds on the final design (the eager tail), after 13 simulator rounds and 6 review
rounds on earlier designs that were dropped (anchors, jumps, an opening window; see the card). **Converged:** Yes, at
iteration 4 (no blocker or warning; a comment nit fixed). A change made in review (a cut in steps of 20) was then
measured to break the fix and was reverted (rounds 16 and 17).

#7265: a long Direct Message on the iPhone opened mid-thread. The chat is a lazy list whose rows below the screen are
only estimated, so the jump to the end stopped short. The newest 40 rows are now drawn eagerly, so their real heights
are known when the jump runs. Validation on 4fb6582854 (rebased on main): simulator, a 260-message chat of varied
lengths, 10 opens each arm read at 4 s and 10 s: with the fix 20 of 20 on the newest message, without it 0 of 20; a
short chat opens exactly as without the fix; scroll to the top holds. ios/LogicTests/run.sh PASS 1340/1340;
server.ios-routes-6838, ios.board-parity-7084, ios.dmfailed-7136, ios.store-shots-proxy-6262 pass; Swift typechecks for
the simulator (iOS 16 floor).

### Per-Iteration Breakdown (final design)

#### Iteration 1
- [WARNING] the eager rows all count as on screen together, so a page landing above could anchor the reader up to 40
  rows away --> FIXED (a reader at the newest message is kept there). [WARNING] a row crossing to the lazy part is
  rebuilt each new message --> tried a cut in steps of 20; measured to stop the open short (0 of 10), REVERTED to the
  exact cut, STATED LIMIT.

#### Iteration 2
- [WARNING] atBottom starts true, so a reader at the top could be pulled down --> FIXED (only when the top is not
  showing). [WARNING] the keep-at-end scroll was animated --> FIXED (no animation).

#### Iteration 3
- [WARNING] atBottom true without the end marker ever showing --> FIXED (endSeen, reset with the thread).

#### Iteration 4
- No blocker or warning. [NIT] the eagerTail comment --> FIXED.

Stated limits: a reader stopped part way inside the newest rows as an older page lands may still move; each new message
rebuilds one row as it crosses to the lazy part.
