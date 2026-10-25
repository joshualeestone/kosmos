---
pre_challenge: true
method: challenge-loop
branch: roommention-7085
diff_hash: 0f509b394d190641d3f06afa9c30d2a8140cfe7af50561f85b3ed5cf01b0661f
validation: passed (full validation_log_run_or_skip, run locally on this Mac at da7b02851a, rebased on origin/main after PR #7091, EXIT=0, "validation PASSED for stack=typescript hash=0f509b394d19"; plus run-room 208/208, run.sh 1195/1195, run-actions 99/99, run-settings 42/42, run-tasks 90/90, run-taskpage 108/108, server.ios-routes-6838 5/5; Debug simulator build with -warn-long-expression-type-checking=100, no slow expressions, and the KOSMOS_STORE_SHOTS Release build, both SUCCEEDED. Broken-copy controls each round red (listed in .claude/plans/roommention-7085.md). No screenshots: the simulator shot run is not permitted on this machine, #7055.)
subdir_audit: not run (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-25T06:54:43Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4, one fresh blind reviewer at a time.
**Converged:** Yes. Round 3 found one nit; round 4, on the rebase onto main with #7080's working line, found one nit, recorded below and not changed.
**Asked (awaiting user):** 0
**Split out:** none.

## Iteration 1
- [WARNING] The key-start match could be removed with the suite green. Fixed: a case only the key satisfies ("DANA").
- [WARNING] A row cap let three wrapped rows at the largest text size run under the navigation bar. Fixed (refined in round 2).
- [WARNING] VoiceOver lost its place after a pick and heard nothing on open. Fixed: focus back to the box, an announcement on open.
- [NIT] The key in the VoiceOver label; the board's shadow; a no-key test. Fixed.
- [NIT] The list covers Stop replying and Reopen while open. Recorded in the plan.

## Iteration 2
- [WARNING] A maximum height under fixedSize capped nothing. Fixed: a measured height up to half the thread.
- [WARNING] The open announcement was not queued. Fixed: Self.say.
- [NIT] The é@ro test only checked for a token. Fixed: checks what is typed.

## Iteration 3
- [NIT] The measured height carried over between opens. Fixed: reset on close. Also scrollDismissesKeyboard(.never).

## Iteration 4
- [NIT] On iOS 16.0 to 16.3 a short list can rubber-band. Not changed: reasoned only, a small drag, and 16.4+ is unaffected; it joins #6838's real-iPhone list.
