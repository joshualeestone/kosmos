---
pre_challenge: true
method: challenge-loop
branch: exittrap2-6831
diff_hash: 04c12e485534852fac3da53753c2572fbd90c2e1d127c4d5a27196f78026b735
validation: passed
subdir_audit: passed
timestamp: 2026-10-21T20:51:17Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Re-hashed 2026-10-21 19:33 CDT after rebasing onto main** (PR #6860 was green but behind main). The only conflict
was package.json `test:shell`, resolved as main's line plus this branch's three entries (exit-guard.sh, its test,
computed against the merge base: nothing removed, nothing already on main). No code changed. Main now runs most
shell tests on Linux (#6814); the guard library has no bash-only syntax and behaves correctly under dash (run by
hand: the two deaths keep status 2, falling off the end becomes 1 with its line, a finished run exits 0), which is
the "keeps the status" branch the test already handles. On the rebased head: test-exit-guard-6831.sh 43 ok, 0 bad;
every-test-runs + engine.reachable + shell-shard-4317 35/0. The full local suite ran at the pre-rebase hash
ad35a787 (22956 tests, fail 0); the PR's CI validates the rebased tree.

**Iterations:** 6
**Converged:** Yes (iteration 6 returned no new BLOCKER, WARNING or CONVENTION)
**Total findings:** recorded per iteration below from the iteration commits (the ledger lived in the reviewing session's context, which ended at the 13:30 fleet restart; each commit message lists what its iteration fixed)
**Fixed:** every finding below | **Deferred:** 0 recorded | **Asked (awaiting user):** 0

**Validation:** full local suite at this exact diff hash, 2026-10-21 15:50 CDT: 22956 node tests, fail 0, shell stages clean, validation-log status clean (hash ad35a7878ae3). The first run at the same hash failed 2 of 22956 (bridges.board-proof-1765, server.slowrequest-6721), neither touched by this branch; alone they failed once in 13 runs and passed 5 of 5 on both this branch and main, so recorded as flakes, and the full re-run is clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (not recorded; the session that ran it ended at the 13:30 restart)
**Self-generated:** 0 (first reviewer pass)
- [WARNING] tools/test-exit-guard-6831.sh: R probed /bin/bash, not the PATH bash release.sh runs under --> FIXED (2d708cdd08)
- [WARNING] tools/test-exit-guard-6831.sh: P caught only a literal `exit 0` after the guard, not a bare `exit` or `exit "$var"` --> FIXED (2d708cdd08)
- [CONVENTION] tools/lib/exit-guard.sh: header did not say a failing cleanup ends the trap with its status --> FIXED (2d708cdd08)

#### Iteration 2
**Reviewer model:** unknown (not recorded)
- [WARNING] tools/lib/exit-guard.sh: a failing cleanup could stop the check or fail a finished run; now `|| :` --> FIXED (2b76899a95)
- [WARNING] tools/test-exit-guard-6831.sh: the 'says so' check was not required for the fall-off-the-end arm --> FIXED (2b76899a95)
- [WARNING] tools/release.sh: no pin against `exit 0` or a bare exit after its first guarded trap --> FIXED (2b76899a95)

#### Iteration 3
**Reviewer model:** unknown (not recorded)
- [WARNING] tools/test-exit-guard-6831.sh: exit pins missed `exit` after then, else and do --> FIXED (379358b687)
- [WARNING] tools/lib/exit-guard.sh: a cleanup dying on an unset variable could fail a finished run; now a subshell with set +u --> FIXED (379358b687)
- [CONVENTION] tools/lib/exit-guard.sh: trap ended differently from release.sh's; now `exit "$_kx_rc"` --> FIXED (379358b687)
- [CONVENTION] plan: did not say a changed build-installer-pkg.sh makes the next cut rebuild and notarise Kosmos.pkg --> FIXED (379358b687)

#### Iteration 4
**Reviewer model:** unknown (not recorded)
- [CONVENTION] tools/lib/exit-guard.sh: did not say it is outside the pkg input hash on purpose --> FIXED (b3a66211ce)
- [WARNING] tools/build-kosmos-windows.sh: no pin that _win_tmp_made=1 is set once, right after its mktemp --> FIXED (b3a66211ce)
- [WARNING] tools/lib/exit-guard.sh: its message claimed a cause above that the fall-off-the-end path may not have --> FIXED (b3a66211ce)

#### Iteration 5
**Reviewer model:** unknown (not recorded)
- [BLOCKER] tools/release.sh: under set -e a closed stderr aborted the trap on its new echo, so a dying cut was never recorded, the claim not freed, the site not restored; _rc=1 now set first and the echo carries `|| true` (same in exit-guard.sh) --> FIXED (0e723dcbcf)
- [WARNING] tools/test-exit-guard-6831.sh: R arms now run each lifted trap with stderr closed; without `|| true` they record nothing (mutant red) --> FIXED (0e723dcbcf)

#### Iteration 6
**Reviewer model:** unknown (not recorded)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs
**Converged** - no new actionable findings.

### Outstanding questions
None.

### Strengths (across iterations)
- Every guard change was shown red by an injected mutant before it was trusted.
- The bash 3.2 mechanism (set -e plus an EXIT trap loses the failure status) is measured on /bin/bash and /bin/sh, with the card's table as the control.
