---
pre_challenge: true
method: challenge-loop
branch: tellstate-5836
diff_hash: 8a0a0e4a10b692756c3a255f53e833c7081b4f9b24ed6b0390537d24a8317e67
validation: pending (full suite not run locally: Agent1s queue busy; the PR's GitHub CI runs it. Focused on the final head, branch even with origin/main: 293 pass, 0 fail across the card's tests, the task/ran tests, the CLI parity and help pins, doctrine/defaults, agent-token gate, fixture-discipline, brand/name refs, sandbox, the three Windows guards; tools/test-kosmos-help-exit0-3036.sh 0 failures; browser-check surface and coarse gates pass)
subdir_audit: passed
timestamp: 2026-10-11T11:34:16Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (blind subagents, opus)
**Converged:** Yes, with a stated judgement: iteration 2 found 0 BLOCKERs and 2 WARNINGs, both in `told`'s word parsing (mixed --value/bare words on the Mac; `--` kept as text), fixed in bde8cc643 with tests on both CLIs. Iteration 2 confirmed every iteration-1 fix correct. No third round on two parsing cases.

### Iteration 1
**Findings:** 0 BLOCKERs, 3 WARNINGs, 9 NITs
- [WARNING] a run absorbed as a duplicate threw its reading away and answered vs_told for the old one (a false "same") --> FIXED 1daa86ac3 (vs_told for the reading sent; a duplicate with a different reading keeps it)
- [WARNING] a bare told recorded another agent's latest reading --> FIXED (default only for the caller's own reading)
- [WARNING] no perl ended the Mac CLI after the run was recorded --> FIXED (|| true)
- [NIT] help line lacked told; told refused bare words; --value took an option as the reading; page order when told after the reading --> FIXED
- [NIT] commit 0fc42ad30's message described the doctrine-past change imprecisely --> NOTED here (the rows are all present; the doctrine test guards them)
- [NIT] long unbroken values can overflow the task row (as lastRunNote already can) --> ACCEPTED, noted in the browser-check trailer
- [NIT] valueProblem folds newlines rather than refusing; the 500 cap is on the raw string --> ACCEPTED
- [NIT] after close and reopen, old verified/told show again --> ACCEPTED (what the person knows does not reset)

### Iteration 2
**Findings:** 0 BLOCKERs, 2 WARNINGs, 5 NITs
- [WARNING] Mac told dropped bare words before --value --> FIXED bde8cc643 (both join in order)
- [WARNING] `--` became part of the told text --> FIXED (-- ends options on both)
- [NIT] noteProblem's comment displaced --> FIXED
- [NIT] paneless spelling can refuse a bare told (fails safe); verified.at vs lastRunAt on a duplicate --> ACCEPTED

### After the loop
- A design-shots screen, task-told-5836, added for the house screenshot rule (docs/browser-checks/mobile-shots.js + README line); test-only, not re-reviewed. tools.mobile-shots-desktop and browser-checks-reason-grep pass; both browser-check gates pass.

### Mutation checks
- engine duplicate-keeps-reading removed: the duplicate test FAILS; server vs_told-from-sent removed together with it: FAILS (the server half alone is a second line of defence, not independently pinned)
- setTold's own-reading rule removed: the two-agent test FAILS
- earlier: the CLI set -e trap was caught by the no-value control arm
