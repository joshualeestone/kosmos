# heldwait-7751: the iPhone task page logic suite can segfault after a leaked continuation (kosmos#7751)

Finished means: the task page logic tests' fake Mac runs on the same actor as the model it serves, so no test races it; a hold a test waits for and never reaches ends the run with a FAIL verdict instead of carrying on; and two holds at once stop the run instead of dropping a continuation.

Measured, both arms (ThreadSanitizer build of ios/LogicTests/run-taskpage.sh's file list, this Mac, Swift 6.4 in Swift 5 mode):
- Before: 2 of 3 runs abort with Swift access races (3 and 8 reports), first at main.swift's `mac.asked.count` check against `FakeMac.send` called from `asyncSend` on another thread. 1 of 3 clean, as a race would be.
- After: 5 of 5 runs, 0 reports, 109/109. The plain script: 109/109.
- The new wait, with one hold removed on purpose: `FAIL the test reached its hold`, `VERDICT: FAIL 1 of 88`, exit 1.

Decided:
- The cause is isolation, not the yield bound alone. A nonisolated async method runs off the caller's actor in Swift 5 mode, so `asyncSend` ran on a pool thread while the test yielded on the main actor; yields there do not wait for another thread. @MainActor on FakeMac (and ParseGate) makes them interleave on one thread. Rejected: only raising the yield bound, which leaves the race.
- Bounded wait that fails loudly (100,000 yields), not an unbounded one: an unbounded wait would hang the job to its 40 minute timeout instead of naming the line.
Weakest premise: that CI's segfault on run 41351865311 is this race. TSan shows the race here and a race on `held` explains a dropped continuation followed by a crash, but the CI crash itself was not reproduced.
What would change this: the segfault again on a run carrying this change.
