---
pre_challenge: true
method: challenge-loop
branch: pgroup-4669
diff_hash: 4179c4c1c128f3290bbea7f88499e6a0653d6fc3dbb60aacc0e34c7a0b9a899c
validation: passed (full tools/run-tests.sh through validation_log_run_or_skip, run on MORTALS via ~/.cache/claude-handoffs/mortals-validate.sh at 742e9e5c0 under Splinter's #4609 jam-unstick turn call with KOSMOS_TESTS_IGNORE_SUITE=1, ended 2026-09-29 21:48 CDT: EXIT=0, node 12308 tests, 0 failed, 0 cancelled, shell part green; recorded entry hash 4179c4c1 equals this worktree's. The first run (21:26) failed on the #3628 meta-guard, fixed in 742e9e5c0)
subdir_audit: passed
timestamp: 2026-09-30T02:49:10Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (both blind, general-purpose reviewers)
**Converged:** Yes, at iteration 2: zero BLOCKERs, zero WARNINGs in either round.
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 10 NITs (all taken or written down).
**Found by the full suite, not the review:** the new test missed the #3628 exit-code check; fixed in 742e9e5c0.

### Per-Iteration Breakdown

#### Iteration 1
- Verified: set -m under /bin/bash 3.2 prints no job notices with and without a terminal, is not stopped by SIGTTOU/SIGTTIN, and set +m is always reached under set -e
- Verified: $! is still the board's node pid (env and nohup exec); stop, restart and the #3079 reclaim kill by exact pid, never by group
- Verified: no other launch site in install/, bin/ or engine/ backgrounds a long-lived process from a launchd job
- [NIT] cli.start-own-pgroup-4669.test.js - a stub board could leak when the start failed after launching node --> FIXED (finally reads board.pid)
- [NIT] the launchd-style kill could hit a stranger that reused a pid --> FIXED (only pids whose command names this run's sandbox)
- [NIT] kill(pid, 0) succeeds on a zombie --> FIXED (polls up to 1 s)
- [NIT] install/kosmos comment claimed the old login job without measuring it --> FIXED (says what was measured: the watchdog, and a throwaway job of that shape)
- Out of scope, noted: node resets SIGHUP, so nohup alone never protected the board; this change helps (the board leaves the terminal's group)

#### Iteration 2
- Verified under a pty: the terminal keeps its foreground group; nothing is stopped
- [NIT] bin/board-watchdog.sh - kickstart -k no longer reaches a board kosmos start launched --> FIXED (comment: the #3079 reclaim frees a held port instead)
- [NIT] under set -m the board no longer starts with SIGINT/SIGQUIT ignored --> FIXED (documented; it handles SIGINT itself)
- [NIT] the first commit's message overstated "red on main (both arms)" --> CORRECTED in a later commit message (the control is red by its shape check)
- [NIT] the control's text surgery was brittle --> FIXED (drops set -m/+m lines near the launch, requires exactly two)
- [NIT] the surviving board waited 2 s --> 1 s
- [NIT] the launchd model is not tested in CI --> the real-launchd reproduction is recorded on #4669 (comment 5901814664)
- CONVERGED: zero BLOCKERs, zero WARNINGs.
