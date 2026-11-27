---
pre_challenge: true
method: challenge-loop
branch: boardshot-9202
diff_hash: be984e6ed5593a25081b89b1d30ff10329b48fe082c819359bc5ba58a4faec60
validation: passed (this Mac, tools/run-tests.sh alone, KOSMOS_SUITE_MAX=1) at f5ed3827fd (origin/main merged in), ended 03:04 CST 11-27: 31,716 node tests 0 failed, all four shell shards status 0; validation-log hash be984e6ed559 equal to diff_hash. The UI test itself is not in that suite: it ran by hand in one queued-heavy turn (02:21 to 02:31 CST) on a fresh iPhone 17 simulator, xcodebuild test as ios/tools/ui-sample.sh runs it: light 2/2 passed (read #faf9f7 x4, scale 3.0), dark 2/2 passed (read #0c0d0f x4), and the CONTROL, the app built with navy painted behind the Close bar, failed it ("NAVY at (390.0, 84.0)", read #17233d x4). On the PR it runs in the ios workflow's sample-board job. Static set 4,127/4,127 and the browser-check surface gate rc 0.
subdir_audit: passed
timestamp: 2026-11-27T09:04:03Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, sonnet, opus), reading the code (the machine was busy with heavy runs); the measured runs came between rounds 1 and 2.
**Converged:** Yes. Round 3: NO NEW FINDINGS.

### Iteration 1 (opus)
- [IMPORTANT] UIImage.scale may not be the device scale --> FIXED (pixels per point from the image, asserted 2x or 3x)
- [IMPORTANT] the top sample point near a notch or island --> FIXED (right side, just above the Close row)
- [IMPORTANT] a fixed settle could catch the question's fade --> FIXED (wait for it to be gone)
- [NIT] control image format, raw colours attached on a pass, header claims --> FIXED

### Iteration 2 (sonnet)
- [IMPORTANT] the header overclaimed (a missing bar background reads as ground too) --> FIXED (it catches a wrong colour; measured with the navy control)
- [NIT] "CI runs it in light" --> FIXED ("a fresh simulator is light")

### Iteration 3 (opus)
- NO NEW FINDINGS.
