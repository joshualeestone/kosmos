---
pre_challenge: true
method: challenge-loop
branch: probebudget-5723
diff_hash: 458e44dcf25fd811e8840173bd54c7d5a208d6a9dc766e1e4e48cdbbb1a87421
validation: NOT a clean local pass, stated plainly. The one full validation ran while host load climbed to 17.8 and failed 21 wall-clock tests outside this diff (fetchComputers 20 s, #1556 5 s, #1673 5 s, #1916 15 s, #1970 20 s and others): the #5727 class. The test this branch changes passed in that run (7.2 s whole command at load ~18) and 4 of 4 alone. Positive control: with the page given a fresh 6 s (the #4466 defect), the page is dropped at 11.2 s and the arm fails. The merge is gated on GitHub CI (clean runners), all green on the exact head.
subdir_audit: passed
timestamp: 2026-10-09T22:57:57Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (self-review against measurement, then one blind review)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 2 WARNINGs, 2 NITs
**Fixed:** both WARNINGs and one NIT; one NIT left with a reason | **Asked (awaiting user):** 0

The change (#5723): the stub board records when the client drops the never-answered page connection, and the #4466 one-budget arm asserts that is under 8.5 s from the first request (once ~6 s, twice ~11 s), instead of timing the whole command.

### Per-Iteration Breakdown

#### Iteration 1
- [WARNING] my first fix (measure from the first request instead of t0) was built on a wrong premise: that bash start-up was the extra time --> FIXED. Measured 9.65 s from the first request with 31 ms of start-up, so the extra time is the lsof ownership sweep in _health_no_answer after the page timeout. The arm now measures the page budget itself on the board, which excludes the sweep by construction.

#### Iteration 2 (blind review)
- Checked: the health and page requests are two separate curl processes, so they use separate sockets; only the page branch attaches the close listener, so the health socket cannot write .pageclose.
- Checked: one page request per _health_probe (no retry loop on this direct call), and the stub is SIGKILLed, so no teardown close overwrites the value.
- Checked: with a fresh 6 s for the page, the close lands near 11 s and fails < 8500. Re-run on the final version: page dropped at 11144 ms, red.
- [WARNING] .pageclose was read with no wait; a lagging stub or a missing page request read as a bare ENOENT --> FIXED (poll up to 2 s, then a named failure: "the page was never requested, or its connection never closed").
- [NIT] dropping the whole-command ceiling hid a retry, a sleep or a second sweep --> FIXED (a loose < 20 s ceiling, far above the lsof cost).
- [NIT] the stub comment says curl's -m ending; any client exit closes the socket --> LEFT (nothing else ends curl in this arm).
