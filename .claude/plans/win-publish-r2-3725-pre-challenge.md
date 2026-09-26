---
pre_challenge: true
method: challenge-loop
branch: win-publish-r2-3725
diff_hash: b0a7243392b8c4d5b9adfffbf248714b51555cb5ab084a305dbfb2f96790ca54
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T08:41:03Z
iterations: 25
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 25 (fresh blind reviewers). Iterations 1 to 23 are recorded one commit each in the branch history ("iteration N: ..."), including the last BLOCKER, iteration 23 (an undo must never write after its lock is lost).
**Converged:** Yes. Iterations 24 and 25 found no BLOCKER or WARNING.
**Validation (this HEAD, rebased onto origin/main):** tools/test-publish-r2-3725.sh all passed (88 checks); tools/test-promote-channel-win.sh ALL PASS. The full yarn test was run before merge.

### Per-Iteration Breakdown

#### Iteration 24
**New findings:** 0 BLOCKERs, 0 WARNINGs, 6 NITs
- [NIT] the lock age uses the client clock --> ACCEPTED (needs a manual -BreakLock AND clocks over 35 min apart; pinned writes still catch it)
- [NIT] a transient lock-check failure was reported as "lost" --> FIXED (412 = taken; any other status = could not confirm)
- [NIT] Ctrl+C leaves the lock for 35 minutes --> ACCEPTED (fails closed; the runbook documents -BreakLock)
- [NIT] a lost lock-PUT response orphans the lock --> ACCEPTED (fails closed)
- [NIT] a zip with no baked version skipped the version check --> FIXED (refused)
- [NIT] -ServedBase was not checked against -KeyPrefix --> FIXED (refused)

#### Iteration 25
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
- [NIT] no test for the no-baked-version refusal --> FIXED (red against the previous script)
- [NIT] no test for the -ServedBase/-KeyPrefix refusal --> FIXED (with a control that gets past the check; red against the previous script)
- [NIT] no test for the non-412 lock-check wording --> ACCEPTED (the fake transport has no 5xx hook; the wording is a message, not a gate)

## Weakest premise
Measured on pwsh 7 on macOS only. Windows PowerShell 5.1 is checked by reading. Homer's first run on the PC is -DryRun, as RELEASING.md says.
