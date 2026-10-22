---
pre_challenge: true
method: challenge-loop
branch: notice-6487
diff_hash: 2f60050941ecf03153309a47f78fb5839196742ee69ddd59e0b67aa36cd9c53c
validation: passed
subdir_audit: passed
timestamp: 2026-10-22T21:48:16Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (one blind reviewer at a time)
**Converged:** Yes (iteration 3: no BLOCKER or SHOULD-FIX; 3 NITs, 2 fixed, 1 kept)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 3 SHOULD-FIX, 2 NITs
- [SHOULD-FIX] engine/phonenotice.js words skipped the setup guide's read-side mask (#3769) --> FIXED (e0ef6e4ba5): wordsFor takes a mask, server.js passes guideMasked, applied before the cut
- [SHOULD-FIX] no test proved the route is behind the board gate --> FIXED (e0ef6e4ba5): an enforcing-board test, 403 without the token, 200 with it
- [SHOULD-FIX] the borrowed-name 404 had no test --> FIXED (e0ef6e4ba5): a stranger's pane holding the name answers 404, with a tied control
- [NIT] the whole report file was read on every notice --> FIXED (e0ef6e4ba5): the last 4 MB only
- [NIT] a report at that time answered whatever its state --> FIXED (e0ef6e4ba5): needs_you only

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 SHOULD-FIX, 4 NITs
- [SHOULD-FIX] a hard cut could split an emoji (a lone surrogate a strict phone decoder refuses) --> FIXED (b5299568ce)
- [NIT] the cut-row test could not fail --> FIXED (b5299568ce)
- [NIT] a window starting on a whole row dropped it; readSync's count ignored --> FIXED (b5299568ce)
- [NIT] a miss scans the whole 4 MB window --> KEPT: gated, once per notification
- [NIT] the card lookup differed from the thread readers --> FIXED (b5299568ce): ourCardByName

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 SHOULD-FIX, 3 NITs
- [NIT] the cut-row assertion started its read past the half row --> FIXED (2d5b6b46fc)
- [NIT] the tests' person rows carried a from field real ones do not; no person-only case --> FIXED (2d5b6b46fc)
- [NIT] /api/phone/notice is named unlike /api/phone-notify and answers GET only --> KEPT: nothing calls it yet but the iOS extension (nse-6487), which uses this path
**Converged:** no new actionable findings.

### Final validation
- Full suite (tools/run-tests.sh, queued-heavy) on cc918f7092: 23358 tests, 23032 pass, 0 fail, END rc=0 16:46 CDT 2026-10-22.
- engine/phonenotice.test.js 7/7 and server.phonenotice-6487.test.js 6/6; each new rule has a control shown to fail without it (the mask, the gate, the borrowed name, the emoji cut, the cut row).
