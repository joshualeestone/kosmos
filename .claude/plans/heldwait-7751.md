# heldwait-7751: the iPhone task page logic suite can segfault after a leaked continuation (kosmos#7751)

Finished means: the task page logic tests' fake Mac runs on the same actor as the model it serves, so no test races it; a hold a test waits for and never reaches ends the run with a FAIL verdict instead of carrying on; two holds at once (a request, or a parse or build behind ParseGate) stop the run instead of dropping a continuation; and a hold armed while another is armed or held stops it too, so the hold a test waits for is the one it armed. Each of these stops prints a FAIL line and the verdict: a precondition would trap with no message in the suite's -O build.

Measured, both arms (ThreadSanitizer build of ios/LogicTests/run-taskpage.sh's file list, this Mac, Swift 6.4 in Swift 5 mode):
- Before: 2 of 3 runs abort with Swift access races (3 and 8 reports), first at main.swift's `mac.asked.count` check against `FakeMac.send` called from `asyncSend` on another thread. 1 of 3 clean, as a race would be.
- After: 5 of 5 runs, 0 reports, 109/109. The plain script: 109/109.
- Each stop, broken on purpose in a scratch copy, in the suite's -O build (a reviewer re-measured the first two):
  - one hold removed: `FAIL the test never reached its hold: a request held (line 394)`, `VERDICT: FAIL 1 of 88`, exit 1.
  - a request hold armed twice: `FAIL a hold was armed while an earlier one was still armed or held (line 392)`, exit 1.
  - a ParseGate hold armed while one is held: `FAIL a parse or build hold was armed while an earlier one was still armed or held (line 434)`, exit 1.
  - The second-hold checks inside asyncSend and ParseGate.park were not exercised: arming refuses first, so they are backstops.

Decided:
- The cause is isolation, not the yield bound alone. A nonisolated async method runs off the caller's actor in Swift 5 mode, so `asyncSend` ran on a pool thread while the test yielded on the main actor; yields there do not wait for another thread. @MainActor on FakeMac makes asyncSend run on the main actor with the test. ParseGate was already only touched from closures made on the main actor; its @MainActor makes that a compile-time fact rather than fixing a race. Rejected: only raising the yield bound, which leaves the race.
- Bounded wait that fails loudly (100,000 yields), not an unbounded one: an unbounded wait would hang the job to its 40 minute timeout instead of naming the line.
Weakest premise: that CI's segfault on run 41351865311 is this race. TSan shows the race here and a race on `held` explains a dropped continuation followed by a crash, but the CI crash itself was not reproduced.
What would change this: the segfault again on a run carrying this change.
