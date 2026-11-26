---
pre_challenge: true
method: challenge-loop
branch: tallopen-9089
diff_hash: 385034060279837715a2cd5fe2f330b72d936711062ac2495d96e508e72ff342
validation: passed (Mortals, 2026-11-26 09:37 to 10:06 CST, head b8324e3b2f: entry status clean, hash equal; 31,464 node tests, 0 failed; all four shell shards green)
subdir_audit: passed
timestamp: 2026-11-26T16:06:52Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (round 4, a blind read of the whole branch, raised no BLOCKER and no SHOULD-FIX)
**Fixed:** 2 SHOULD-FIX (rounds 1 and 2), the trace allow-list red, and the personMoves defect the measurement found
**Deferred:** known limits, each recorded in the plan (iOS 17, a no-finger scroll in the first 1.6 s, a kept copy
replaced later) | **Asked (awaiting user):** 0

Built by Angel (fix 4571db2412); taken to PR by Mona Lisa from 11-26 03:04. Rebased onto main at 09:0x (ui-sample.sh:
both new class lines kept); every logic suite and the two ui-sample tests pass after it.

### Measured (iPhone 17 simulator, iOS 27, ChatTallOpenUITests x3 per arm)

- lazy list WITHOUT the fix: tall20 failed 3 of 3 (the bug), short20 passed.
- lazy list WITH the fix at 6d54df5ddb: tall20 FAILED 3 of 3. Round 1's personMoves counted every scroll rest, so the
  list's own settling silenced the open's looks. Fixed at 23573eefcf (count only the person's scroll phases).
- lazy list WITH the fix at 23573eefcf: tall20 PASSED 3 of 3 (newest wholly on screen, first and second open).
- UIKit list with the fix: 6 of 6.
Posted on #9089 (comment 7193292665).

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [SHOULD-FIX] a later look could pull back a reader who scrolled up in the first 1.6 s --> FIXED (personMoves; its
  first form killed the fix, found by measurement, corrected at 23573eefcf)
- [SHOULD-FIX] the control had not run --> RUN (above)

#### Iteration 2 (sonnet)
- [NIT] the looks stood down for good once the end showed briefly --> FIXED (!(endSeen && endVisible))
- [NIT] the test's stillness read could fall between looks --> FIXED (waits 2 s)
- [SHOULD-FIX] a VoiceOver scroll may not count --> RECORDED as a known limit

#### Iteration 3 (opus)
- [SHOULD-FIX, evidence] the head had never run --> MEASURED (above)
- [NIT] personMoves' comment --> FIXED

#### Iteration 4 (opus)
**New findings:** 0 BLOCKERs, 0 SHOULD-FIX. Known limits recorded.

### Also fixed before review
- The room suite's #7420 allow-list refused the new trace line's `at` value: the line records no value now.
- ChatTallOpenUITests:2 added to CI's lazy-arm sample run (ios/tools/ui-sample.sh).
