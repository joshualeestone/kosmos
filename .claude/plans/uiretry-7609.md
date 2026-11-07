# uiretry-7609 (kosmos#7609): make the iPhone UI job trustworthy

**Finished looks like:** main's ui job stops going red on a slow wait, while a test failing twice is still red; every flake is named on the run and countable; EndPull no longer fails on where a chat opened. Measured across main's next 10 runs.

**Evidence:** 58 runs, table on the card: 18 of 54 red, main 7 of 21, 15 different tests, all on GitHub's hosted runners. Mostly waits running out. EndPull lands at 624 every time; its "before" varies.

**Change:** one retry per failed test (`-retry-tests-on-failure -test-iterations 2`), a tally that counts a test once by its last result and names flakes, 50 minutes for the job, EndPull's baseline taken after a small settling touch, with a note saying how far short it opened.

**Rejected:** longer waits test by test; skipping more tests; a bigger runner (cost, not mine to spend).

**Weakest premise:** that a retry only hides slowness. A real defect failing half the time now passes, shown only by the FLAKY count. So the count is read: a test flaky on 3 of 10 main runs gets looked at, not left.

**Not here:** re-arming AttachMenu's largest-text test: separate, it timed out 6 of its last 8 and a retry will not save it.
