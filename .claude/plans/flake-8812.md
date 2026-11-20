# flake-8812: "#6204 review 8" fails in CI when the clock turns at the wrong moment

Card: #8812. Seen red in CI on PR #8810 (run 44706101715), not reproduced on Agent1s.

## Cause (measured)
`readReplies` round 2 records `round2Start = Date.now()` and its wave loop checks
`Date.now() - round2Start < round2Ms` BEFORE the first wave. The test gives `round2Ms: 1`, so whenever the
millisecond turns between the two reads (more often on a busy runner) no wave runs and the new thread's deep reply
is never read. Reproduced with a preload that advances `Date.now()` by 1 ms per call: the test fails with CI's exact
message ("the new thread's deep reply was held behind the saved threads").

## Fix
Once round 2 runs at all (`round2Ms > 0`), its first wave always runs; the window bounds only the waves after it.
`round2Ms: 0` still skips round 2. In production the window is `ROUND2_START_MS`, far longer than the gap between the
two clock reads, so production reads are unchanged; the two `round2Ms: 25` tests (30 ms pages) become deterministic
on the same grounds.

Rejected: widening the test's window (4 ms against 5 ms pages). Still timing-dependent, only less often.

## Checks
- New test `kosmos#8812: round 2's first wave runs however long the clock takes...` stubs `Date.now()` to advance 1 ms
  per read; passes with the fix, fails without it (run by hand).
- Every test file that names communityread (30 files, 765 tests): 0 failed.
