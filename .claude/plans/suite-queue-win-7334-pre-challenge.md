---
pre_challenge: true
method: challenge-loop
branch: suite-queue-win-7334
diff_hash: 823b12ae48d83239dfa5d46070e088ec37d5005b27cdc87ee80b36adea09caf5
validation: windows: test-win-proctable-7334 31 arms 0 failed (after rebase on main); policy tests 67/67; two npm test runs measured queueing
subdir_audit: passed
timestamp: 2026-10-28T00:34:48Z
iterations: 4
converged: true
---

# Pre-PR review proof: suite-queue-win-7334

**Iterations:** 4
**Converged:** Yes. The last round found no BLOCKER; anything it raised is recorded below.
**Per-round record:** .claude/plans/suite-queue-win-7334.md

## Rounds

#### Iteration 1
- Round 1: no blocker. [WARNING] new Windows shard-stop kill path untested --> FIXED: test (own shards stop, an outside process lives). [WARNING] PowerShell answer lost per pipe subshell --> FIXED: file cache keyed pid+winpid+start. [WARNING] backslashed script paths missed (fail-open) --> FIXED. [NIT] walk failure counts the run real --> documented.

#### Iteration 2
- Round 2: no blocker. [WARNING] an unreadable command line of a listed process skipped silently (fail-open) --> FIXED: pgrep exits 2. [NIT] x4 --> FIXED (spaced unquoted path, empty answer caching, stat parsing, empty glob).

#### Iteration 3
- Round 3: no blocker. [WARNING] PowerShell walk unbounded (a wedged WMI hangs the queue) --> FIXED: timeout -k 2 10, test. [NIT] unreadable `ps -o command=` reads as gone, removing a live marker --> DOCUMENTED (no caller reads the status; changing callers means Mac-shared code).

#### Iteration 4
- Round 4: no blocker, no warning. [NIT] timeout.exe on PATH --> FIXED. [NIT] timeout's own process group --> ACCEPTED.

### Final Ledger
| Round | Blockers | Warnings | Outcome |
|---|---|---|---|
| 1 | 0 | 3 | fixed |
| 2 | 0 | 1 | fixed |
| 3 | 0 | 1 | fixed |
| 4 | 0 | 0 | converged |

Windows box: tools/test-win-proctable-7334.sh 31 arms, 0 failures (each later-round arm fails on the previous commit's lib); policy tests fixture-discipline, no-name-refs-3071, engine.reachable, windows-tests-1777, win32-separator-guard, windows-coupling-audit-1732: 67/67. Measured two npm test runs: the second queued ("a test suite is already running") and started 7.4 s after the first ended; both green. Mac/Linux: code paths unchanged by reading (Windows block gated on uname); not run on a Mac from this box: CI's Mac suites are the check.
