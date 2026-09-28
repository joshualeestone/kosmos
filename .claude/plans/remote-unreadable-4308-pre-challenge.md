---
pre_challenge: true
method: challenge-loop
branch: remote-unreadable-4308
diff_hash: 7cd8c4990a81c868b95583f3e72c37ef8caefb15cf158cb623d2eb2ce97075b0
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T07:33:50Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes, at iteration 4
**Total findings:** 0 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 17 NITs
**Fixed:** 5 WARNINGs, 2 CONVENTIONs, 11 NITs | **Deferred:** 6 NITs | **Asked (awaiting user):** 0

Validation: `yarn test` via validation-log, gated on tools/heavy-gate.sh, PASSED for hash 7cd8c4990a81 at 2e7567a:
11101 tests, 10937 pass, 0 fail, 164 skipped. Subdirectory CLAUDE.md audit passed. Both browser-check gates
(#1720 and the #2518 surface gate) pass: the branch does not touch web/index.html.

**After convergence, and not reviewed by a blind pass (stated here, not hidden):**
- c940acd adds the two sweep test cases (a certainly-dead pid; a day-old file whose pid is live) that c04dc0a's
  message described but had not applied. Tests only. The day-old case fails on the engine before the 24h ceiling.
- 2e7567a changes one log line and its comment from "this Mac" to "this computer" (the full suite's
  engine/machine.test.js forbids "this Mac" in a live sentence). Text only.
Iteration 4 reviewed c04dc0a, whose engine code is identical to the final head apart from that one string.

Real board: this branch, sandboxed data, a fake tunnel, an enrolled Mac with a damaged remote.json. The Plus pane
showed the repair sentence under an Off switch; turning the switch on rewrote the file as valid settings, the
sentence went, and no temporary file was left. (Measured before the wording moved into the engine sentence; the
page now shows that sentence, pinned end to end by web.remote-unreadable-4308.test.js.)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 6 NITs
- [WARNING] engine/remote.js device-id mint / turnOnAfterSignin: a sign-in on a damaged file repaired it with no device id, so the next start minted a second one --> FIXED (90734f5, the repair keeps the minted id; test 5)
- [CONVENTION] no plan file matched when the review started --> FIXED (plan committed)
- [NIT] temporary files from killed writes never swept --> FIXED (sweepStaleTemps; test 6)
- [NIT] fsync comment overstated macOS durability --> FIXED
- [NIT] descriptor could be closed twice --> FIXED
- [NIT] 1a/1b mostly pin old behaviour --> FIXED in the plan (which tests carry the change)
- [NIT] message shows "repair by turning on" even when the cause is not bad contents --> DEFERRED (rare; the switch's own error says what happened; named in the plan's weakest part)
- [NIT] plan and page scope --> no change needed (reviewer agreed the enrolled-only scope is right)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
- [CONVENTION] web/ changed with no browser-check assertion or trailer (the #1720 gate refused) --> FIXED (the repair sentence moved into the engine's status(); web/index.html untouched, both gates pass)
- [WARNING] deviceDeny dropped a refused save silently --> FIXED (stderr line)
- [WARNING] the sweep could remove a stalled live writer's file --> FIXED (the pid in the name is checked with kill(pid, 0); test 6 live case)
- [NIT] two sources for one sentence (page and engine) --> FIXED (engine only)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs
- [WARNING] a reused pid sheltered a dead writer's file forever; the comment claimed otherwise --> FIXED (24h ceiling whatever the pid; comment corrected; test added in c940acd)
- [NIT] status() comment said only the switch repairs --> FIXED
- [NIT] internal refusal wording differed --> FIXED
- [NIT] the pane calls the switch "Kosmos Plus" --> FIXED (the sentence says "Turn Kosmos Plus on again")
- [NIT] stale fixture pid could be live on Linux --> FIXED (a certainly-dead child's pid)
- [NIT] the em-dash test read its own literal --> FIXED (reads the engine sentence; uses the escape)
- [NIT] a repair loses a self-hoster's relay override --> DEFERRED (unreadable data cannot be kept; the old code lost it silently on any write; in the plan)
- [NIT] 1a/1b/3/4 pin prior behaviour --> no change needed (the plan says so)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- [NIT] device-id carry keys on `!next.device_id`, not "the patch is silent" --> DEFERRED (no caller clears it; correct for every current path)
- [NIT] fedSetStanding ignores a refused write --> DEFERRED (its one meaningful caller runs after a person's repair; the others write the fail-safe empty value)
- [NIT] switching OFF also repairs --> DEFERRED (the pane can only offer "on" for a damaged file; repairing to off is the safe value)
**Converged:** no BLOCKER, WARNING or CONVENTION findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/remote.js (write repair) | BRANCH | device id lost on a sign-in repair | FIXED | 90734f5 |
| 2 | 1 | CONVENTION | .claude/plans | BRANCH | plan file missing at review start | FIXED | plan committed |
| 3 | 2 | CONVENTION | web/index.html | BRANCH | browser-check gate refused | FIXED | 2e93777 (page untouched) |
| 4 | 2 | WARNING | engine/remote.js deviceDeny | BRANCH | refused save dropped silently | FIXED | 569db21 |
| 5 | 2 | WARNING | engine/remote.js sweepStaleTemps | BRANCH | sweep could remove a live writer's file | FIXED | 569db21 |
| 6 | 3 | WARNING | engine/remote.js sweepStaleTemps | BRANCH | reused pid shelters a dead writer's file | FIXED | c04dc0a, c940acd |

### Deferred NITs
- iteration 1: repair message for a non-content read failure (plan, weakest part)
- iteration 3: a repair loses the relay override (plan)
- iteration 4: device-id carry predicate; fedSetStanding ignores a refusal; OFF also repairs

### Strengths
- The repair gate sits in write(), the one place every write passes, so no background writer can erase a damaged file (iterations 1, 3, 4)
- The device-id carry-over closes a real duplicate "this computer" hole, tested end to end through signinStart (iterations 2, 3)
- One source for the repair sentence, pinned end to end from a real damaged file through status() to paintPlus (iteration 3)
- Test 4's control proves an enrolled, switched-on Mac does call, so its "no call" is not vacuous (iterations 1, 3)
