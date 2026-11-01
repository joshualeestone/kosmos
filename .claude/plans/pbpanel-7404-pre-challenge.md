---
pre_challenge: true
method: challenge-loop
branch: pbpanel-7404
diff_hash: 72e1d3c6b1c22a9f90bf03813760a7a161fa465bdf1902b292d5239fb89869e5
validation: failed on two tests not of this branch (26157 tests, 2 fail, both engine/tasks.recovered-5920.test.js, the daylight-saving red on #7716: they pass under TZ=UTC and fail under TZ=America/Chicago on the same code); no other failure. After the final rebase 6 neighbour and guard files passed; PR CI covers the merge
subdir_audit: passed
timestamp: 2026-11-01T03:42:04Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 1 BLOCKER, 16 WARNINGs, 2 CONVENTIONs, 20 NITs
**Fixed:** 13 | **Deferred:** 6 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 8 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] engine/personalbackup.js:475 — a server's raw text could reach the panel through overAllowance --> FIXED: only fixed sentences, flag to sentence
- [WARNING] overAllowance read as stopped --> FIXED: a plain note
- [WARNING] web/index.html:55677 — first-backup line false with a company here --> FIXED
- [WARNING] web/index.html:55677 — first-backup line false after a failed try --> FIXED, lastTry
- [WARNING] engine/personalbackup.js:464 — a note outlived its enrollment --> FIXED, org and world on the note
- [WARNING] engine/personalbackup.js:498 — words blamed without cause --> FIXED, wordsUncovered
- [WARNING] engine/personalbackup.js:481 — refusedState on another failure --> FIXED
- [WARNING] web/index.html:55667 — page lines untested --> FIXED, pbJobLines with its own test
- [WARNING] test coverage of the real paths --> FIXED
- [CONVENTION] plan name without a timestamp --> DEFERRED: sibling plans use the plain name, and the gate reads it
- [CONVENTION] no aria-live on the stop --> DEFERRED: the panel repaints every 5 seconds, and siblings carry none

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] sentences with no step --> FIXED for tooLarge, the rest DEFERRED to the follow-up the plan names
- [WARNING] tooLarge with overAllowance --> FIXED, pinned as a stop
- [WARNING] "within the hour" a promise about the scheduler --> FIXED, "soon"

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 3 of the above
- [WARNING] gate false with no reason left "on" unqualified --> FIXED
- [WARNING] a company here could be sent through off and on --> FIXED
- [WARNING] too large with a week's pause --> FIXED, says next week

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] dead-end sentences --> DEFERRED: follow-up, named in the plan
- [WARNING] a throw in report() cost the panel --> FIXED
- [WARNING] plan wording about the last run --> FIXED

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] "first backup" false after off and on --> FIXED, "A backup runs soon."
- [WARNING] off then on needs a price --> DEFERRED: #7685, on the switch's HOLD line

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings:** 3
**Converged** — no new actionable findings.

### After the loop
The first validation found nine failures in web.pbcode-7404.test.js: its harness did not lift pbJobLines. Fixed. The second found only the two #7716 daylight-saving failures, which are not this branch's. The browser-check surface gate needed per-check trailers for render-plus-stars-3778.js and render-plus-bar-3837.js.

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] a run across an off and on with unchanged words can land on the new turn-on (iteration 5)
- [NIT] "A backup runs soon." can stand if the tick finds no workers root (iteration 5)
- [NIT] pbPaint's stopped branch is shown by shots, not by a test (iteration 5)

### Strengths (across all iterations)
- All panel text goes in through textContent, and only fixed sentences reach it.
- report() cannot cost the panel its Turn off.
- A passing failure changes nothing a person sees, and a good run clears a stop.
