---
pre_challenge: true
method: challenge-loop
branch: which-room-3224
diff_hash: dcbb202d0ee607bc732123a82178926843a33abf7afae405fa16f60a5e493c6d
validation: passed
timestamp: 2026-09-25T20:12:54Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 surfaced no BLOCKER or SHOULD-FIX)
**Model rotation:** opus, sonnet, opus, sonnet.
**Validation:** validation_log_run_or_skip PASSED (hash dcbb202d0ee6) at 6ccbbabf4. The direct
tools/run-tests.sh run beside it had one red, test-support.cpu-time.test.js (a 40ms wall-clock spin read
0.87ms of CPU with two full suites running); it passes alone 3 of 3 and this branch does not touch it. It is a
flake in my own #3715 test, fixed separately. The first validation found engine.reachable red on an unused
export (setWhichRoomWindowForTests), removed.

Full detail per round is in .claude/plans/which-room-3224.md.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [SHOULD-FIX] the hold fired on every post for an hour, not once --> FIXED: --new marks the row newPost and
  acknowledges questions owed at that moment
- [SHOULD-FIX] a question from a room the agent was removed from, or a deleted room, pointed at a refused
  command --> FIXED: canPostIn via membersOf and _roomMembers
- [SHOULD-FIX] the digest could not tell --new from a misroute --> FIXED: newPost rows not counted
- [SHOULD-FIX] the hold ran before the text checks --> FIXED: after them, before the room valve
- [NIT] recency of an owed target question, id-less asks, unchecked ids, Windows hand-back --> FIXED
- [NIT] agent instructions omit --new; extra record() pass --> DEFERRED with reasons

#### Iteration 2
**Reviewer model:** sonnet
- [BLOCKER] new_post with in_reply_to marked the row newPost and silenced every owed question for up to an
  hour (reproduced end to end) --> FIXED: newPost gated on !citedId; both CLIs refuse the combination

#### Iteration 3
**Reviewer model:** opus
- [SHOULD-FIX] an in_reply_to naming no post skipped the hold while binding nothing --> FIXED: keyed on the
  citation resolving
- [SHOULD-FIX] the digest went blind to the heuristic --> FIXED: counts-only line for --new confirmations
- [NIT] a drained --new post would acknowledge questions it never saw --> FIXED: the drain does not mark
- [NIT] projects.get side effects --> ACCEPTED, noted

#### Iteration 4
**Reviewer model:** sonnet
- No BLOCKER or SHOULD-FIX. [NIT] pre-existing Windows CLI generic hand-back parity (#2710) --> DEFERRED
