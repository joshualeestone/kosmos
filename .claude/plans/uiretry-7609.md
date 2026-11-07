# uiretry-7609 (kosmos#7609): make the iPhone UI job trustworthy

**Finished looks like:** main's ui job stops going red on a slow wait, while a test failing twice is still red; every flake is named on the run and countable; EndPull no longer fails on where a chat opened. Measured across main's next 10 runs.

**Evidence:** 58 runs, table on the card: 18 of 54 red, main 7 of 21, 15 different tests, all on GitHub's hosted runners. Mostly waits running out. EndPull lands at 624 every time; its "before" varies.

**Change:** one retry per failed test (`-retry-tests-on-failure -test-iterations 2`), a tally that counts a test once by its last result and names flakes, 50 minutes for the job, EndPull allows a landing up to 160 pt above where the chat opened (103 to 129 measured) and no further, with a note saying how far, which the script prints. Flakes' first-try words print on green runs too.

**The trade:** the old check was the only CI signal that a long chat opens short of its end (ChatOpensAtNewestUITests is not in CI). A failure becomes a printed note, counted, carried on #8072. Rejected a small settling touch as the baseline: 72 pt arms a read, and a shorter drag may not reach the end.

**Named:** a green run with a flake keeps its first-try words, not its bundle or scroll trace. Whether a test's `print` reaches the log the script reads is unmeasured until a short open happens on CI. On a red run the trace dump can also fire for a keyboard check that failed once and then passed.

**Rejected:** longer waits test by test; skipping more tests; a bigger runner (cost, not mine to spend).

**Weakest premise:** that a retry only hides slowness. A defect failing half the time now passes about 3 runs in 4. So `ios/tools/ui-flaky-count.sh` reads the count from the runs, and Angel reads it on each batch of 10 main runs: a test flaky on 3 of 10 gets looked at. It is a person reading a count, not an alarm.

**Not here:** re-arming AttachMenu's largest-text test: separate, it timed out 6 of its last 8 and a retry will not save it.
