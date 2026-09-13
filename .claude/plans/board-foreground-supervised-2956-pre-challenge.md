---
pre_challenge: true
method: challenge-loop
branch: board-foreground-supervised-2956
diff_hash: 224df31abec00431f6204a4a9476a31b20ce8401ca317778910e554f67ef47f2
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T04:38:12Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (multi-model: sonnet + opus both witnessed a zero-actionable pass)
**Total findings:** 12 actionable (1 BLOCKER, 4 WARNINGs, 3 CONVENTIONs, 4 NITs) + strengths
**Fixed:** 9 | **Deferred:** 2 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation — full kosmos suite)
**Reviewer model:** n/a (mechanical validation)
**New findings:** 2 (both caught by the full suite, missed by targeted runs)
**Self-generated:** 0 (synthetic, BRANCH by instruction)
- [BLOCKER] install.board-job.test.js:137 — asserted the OLD "no KeepAlive" invariant --> FIXED (6c81a0e2): assert the supervised shape.
- [CONVENTION] install/kosmos:495 — bare `[ -x "$LAUNCHCTL" ]` (a directory passes it; runnable-guard) --> FIXED (6e35b0cc): `command -v`.

#### Iteration 2 (blind, opus)
**Reviewer model:** opus
**New findings:** 6 (marker-write-failure loud; per-session-stop comment stale; watchdog comment stale; kickstart comment overstated; recursion glob whole-blob; label "degrades safely" honesty)
**Self-generated:** ~5 of 6 (SELF — comments this loop's own earlier fixes wrote)
- All FIXED (2bb65aba): the recursion glob got a standalone-line grep + a regression test; the rest were code/comment fixes.

#### Iteration 3 (blind, sonnet — multi-model)
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 1 CONVENTION
**Self-generated:** 0
- [BLOCKER] fresh-install double-start: `kosmos start` (nohup) then plist-bootstrap RunAtLoad fires board-run against the served port --> EADDRINUSE + pidfile clobber + launchd churn --> FIXED (a7891184): idempotent `cmd_board_run` guard (red-capability proven) + setup.sh `kosmos restart` reconciliation.
- [WARNING] label mirror diverges on non-default SYMLINKED home --> DEFERRED: non-real-user edge, degrades safely to nohup; documented inline; later pinned by the drift test.
- [WARNING] marker-write-failure branch untested --> DEFERRED: structurally unreachable under the AGENT_WORKFORCE_LAUNCH sandbox (needs real launchd); a diagnostic warning.
- [CONVENTION] label derivation unpinned across the two files (#5) --> FIXED in iter 4.

#### Iteration 4 (blind, sonnet — convergence check)
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0
- [WARNING] cmd_board_run no stranger-on-port guard --> crash-loop --> FIXED (3f75bc9c): `port_taken_by_stranger` silent-defer guard + regression test.
- [CONVENTION] label-drift #5 (re-raised, concrete pattern) --> FIXED (3f75bc9c): behavioral drift pin (extracts setup.sh's block, asserts equal outputs; red-capability proven).
- 2 NITs (heredoc EOF; redundant id -u) --> the pipe-avoidance is already documented at the grep; the double id -u is a harmless syscall. Not changed.

#### Iteration 5 (blind, opus — convergence check)
**Reviewer model:** opus
**New findings:** 0 BLOCKER/WARNING/CONVENTION (2 NITs, 3 STRENGTHs)
**Converged** — no new actionable findings; multi-model witnessed.
- [NIT] cmd_board_run does not defer on a SILENT (non-HTTP) port holder (the #2955 zombie); bounded, explicitly NOT a regression --> follow-up.
- [NIT] tools/restart-local-board.sh:236 stale comment (file not touched by this PR) --> follow-up.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | install.board-job.test.js:137 | BRANCH | old no-KeepAlive assertion | FIXED | 6c81a0e2 |
| 2 | 1 | CONVENTION | install/kosmos:495 | BRANCH | bare `[ -x ]` runnable-guard | FIXED | 6e35b0cc |
| 3 | 2 | WARNING | install/kosmos cmd_stop | SELF | marker-write failure silent | FIXED | 2bb65aba |
| 4 | 2 | WARNING | install/kosmos cmd_start | SELF | stale per-session-stop comment | FIXED | 2bb65aba |
| 5 | 2 | CONVENTION | install/kosmos detect | SELF | recursion glob whole-blob | FIXED | 2bb65aba |
| 6 | 3 | BLOCKER | install/setup.sh + install/kosmos | BRANCH | fresh-install double-start | FIXED | a7891184 |
| 7 | 3 | WARNING | install/kosmos:461 | SELF | label symlink divergence | DEFERRED | non-real-user, safe-degrade; pinned by #12 |
| 8 | 3 | WARNING | install/kosmos cmd_stop | SELF | marker-warning untested | DEFERRED | sandbox-unreachable diagnostic |
| 9 | 4 | WARNING | install/kosmos cmd_board_run | SELF | stranger-on-port crash-loop | FIXED | 3f75bc9c |
| 10 | 4 | CONVENTION | install/kosmos:472 | SELF | label derivation unpinned (#5) | FIXED | 3f75bc9c |
| 11 | 5 | NIT | install/kosmos cmd_board_run | SELF | silent zombie port holder | DEFERRED | bounded, not a regression; follow-up |
| 12 | 5 | NIT | tools/restart-local-board.sh:236 | BRANCH | stale bundle comment | DEFERRED | file not in this PR; follow-up |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking)
- Silent (non-HTTP) zombie port holder makes board-run crash-loop until the port frees/reboot (iter 5) — bounded, not a regression; a `kill -0`/lsof defer would remove the spam. Follow-up.
- tools/restart-local-board.sh:236 stale "kosmos start" comment (iter 5) — behavior unaffected (keys on working dir). Follow-up.

### Strengths (across iterations)
- Recursion-safe supervised detection with a real negative-control test (a path literally containing `board-run` reads NOT supervised).
- Correct launchd PathState semantics (verified vs PlistBuddy), #2955 marker-before-kill ordering preserved.
- Tests non-vacuous and red-capability-proven (pidfile==$$ exec claim; the fresh-install and stranger guards driven against real HTTP servers; the label-drift pin catches a width change).
- Correct avoidance of the pipefail/SIGPIPE trap (here-doc into grep, not printf|grep); bash 3.2-safe throughout.

### Staging-verify items (not locally reproducible — the sandbox skips real launchctl)
1. PathState relaunch promptness (deliberate-stop-stays-down; crash-relaunches).
2. Fresh-install reconciliation ends with exactly ONE launchd-supervised board, no churn.
