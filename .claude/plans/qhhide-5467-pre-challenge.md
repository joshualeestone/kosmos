---
pre_challenge: true
method: challenge-loop
branch: qhhide-5467
diff_hash: b70e7c5d35f5925dfba1dc1297a26c85f50be6a8e8ed3ba181cba17f23608ff7
validation: rebased on origin/main 2026-10-07 05:45 CDT; tools/test-queued-heavy-4977.sh 99/99 (one earlier run had one BAD in an unchanged #5331 capper arm under load 3, passed on rerun); tools/test-light-side-4911.sh, test-pw-version-assert.sh, test-browser-gate-cut-claim-1398.sh pass; bash -n clean; full suite on CI
subdir_audit: not run (no subdirectory CLAUDE.md changed)
timestamp: 2026-10-07T10:46:14Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (alternating opus and sonnet)
**Converged:** Yes (iteration 8: NITs only)
**Total findings:** 0 BLOCKERs, 13 WARNINGs, plus NITs
**Fixed:** 13 | **Deferred:** 0 (one class tracked as its own card, #5470) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] a stale TMPDIR stopped every run before it waited --> FIXED: falls back to /tmp, both sides of the exec
- [WARNING] the file-gone arm had no presence control --> FIXED: the waiter named the file in TMPDIR

#### Iteration 2 (sonnet)
- [WARNING] plan said the waiter marker keeps the label (false) --> FIXED
- [WARNING] ps no longer says what a waiter waits for, unstated --> FIXED: stated as the accepted cost, in code and plan

#### Iteration 3 (opus)
- [WARNING] refusal arms ran unbounded against a held box --> FIXED: own marker dir and a 20 s alarm

#### Iteration 4 (sonnet)
- [WARNING] --queued-args followed a symlink --> FIXED: refused, arm added
- [WARNING] a signal before the re-exec left the file --> FIXED: traps remove it

#### Iteration 5 (opus)
- [WARNING] the failed-exec fallback never ran (bash 3.2 without execfail) --> FIXED: execfail, file removed by hand (bash clears traps while it tries, measured), exit 3, arm added

#### Iteration 6 (sonnet)
- [WARNING] no arm pinned the round trip --> FIXED: a space, an empty argument, a newline, -n, *, stdin and exit code 7

#### Iteration 7 (opus)
- [WARNING] the waiter's parent shell still carries the command, so an unanchored pgrep can still deadlock --> TRACKED as #5470 (one anchored helper for every is-X-running check); finished line narrowed to the waiter process
- [WARNING] (as NIT) a script fed on stdin --> FIXED: refused before the exec, arm added; extra words after the file, arm added

#### Iteration 8 (sonnet)
**New findings:** NITs only. **Converged.**

### NITs (non-blocking, iteration 8)
- the TERM/INT/HUP traps have no arm (a microsecond window)
- the stale-TMPDIR arm does not check the /tmp file is gone
- a rollback to a pre-#5467 copy in the re-exec window would leak the file
- "never" in the header: for microseconds before the re-exec the argv still carries the command
- arguments touch disk briefly (mode 600, same user)

### Strengths
- Same pid, start time, stdin and exit code (exec); every argv reader in cut-guard.sh still works
- The main arm has a control (a copy without the re-exec shows the waiter matched)
