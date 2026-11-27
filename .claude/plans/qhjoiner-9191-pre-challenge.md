---
pre_challenge: true
method: challenge-loop
branch: qhjoiner-9191
diff_hash: 97cc2834606ef405effd4ed625a6ae91bedbc7d4daa43b0062fe02ee712083f5
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T07:43:43Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes (iteration 12: three WARNINGs, all deferred with reasons)
**Validation:** passed locally at c6c5ae024a (31,640 node tests, 0 failed; all four shell shards green; subdir audit clean)
**Reviewer models:** opus on odd rounds, sonnet on even rounds
**Whole file:** 178/178 at dc53f6350b (the final code), run as CI runs it
**Fixed:** about 30 | **Deferred:** 6 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] tools/test-queued-heavy-4977.sh:30 - the stale-TMPDIR arm's waiter writes its arguments in /tmp, outside $S, so the sweep cannot see it --> FIXED (2c873fccae, listed by pid)
- [WARNING] tools/test-queued-heavy-4977.sh:86 - neither helper has an arm --> FIXED (2c873fccae, two regression arms)
- [WARNING] .claude/plans/qhjoiner-9191.md - defect 1 claimed as addressed --> FIXED (7a00b7aa93)

#### Iteration 2
**Reviewer model:** sonnet
**Self-generated:** 3 (code lines from 2c873fccae, fixed normally)
- [WARNING] tools/test-queued-heavy-4977.sh:35 - a recorded pid guarded only by --queued-args --> FIXED (e77bc2fc38)
- [WARNING] tools/test-queued-heavy-4977.sh:36 - the watchdog held an empty snapshot of the list --> FIXED (e77bc2fc38, a file)
- [WARNING] tools/test-queued-heavy-4977.sh:866 - pgrep -o ties to the second --> FIXED (e77bc2fc38)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] tools/test-queued-heavy-4977.sh:853 - readiness passed before the stand-ins exec'd --> FIXED (0fb4f3d35d)
- [WARNING] tools/test-queued-heavy-4977.sh:37 - the reused-pid guard was untested --> FIXED (0fb4f3d35d)
- [WARNING] tools/test-queued-heavy-4977.sh:347 - the call sites were not guarded --> FIXED by documentation, then by a source check in round 4
- [WARNING] tools/test-queued-heavy-4977.sh:36 - the first loop lacked a shape check --> FIXED (0fb4f3d35d)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] call sites unguarded (re-raised) --> FIXED (85bd36c448, source-check arm)
- [WARNING] list cleared by truncation --> FIXED (85bd36c448, own_waiter / unown_waiter)

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] tools/test-queued-heavy-4977.sh:885 - the source check read a relative $0 after the file cds away --> FIXED (e55ae28fb9, $SELF; measured BAD in place before)
- [WARNING] production listed-pid branches unreached by any arm --> FIXED (e55ae28fb9)
- [WARNING] procps pkill -P kills the watchdog before its sweep --> FIXED (e55ae28fb9, then round 6)
- [WARNING] plan recorded no in-place 178 run --> FIXED (plan)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] watchdog still self-killed on Linux --> FIXED (db5e2a5311, own pid, children one by one)
- [WARNING] plan's last run predated an arm --> FIXED (plan)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] watchdog swept sleeps before killing the children --> FIXED (49a95406f1, new order)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] watchdog pid from perl could be empty --> FIXED (909f29b1be, sh)
- [WARNING] same-tree pid reuse inside the arm's window --> DEFERRED, then closed by the parentage check in round 11

#### Iteration 9
**Reviewer model:** opus
- [WARNING] source check did not pair names --> FIXED (166d011a6f; CONTROL: a swapped pair reads 2)
- [WARNING] no whole-file run at HEAD --> FIXED (recorded)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] fork-to-exec window for the listed pid --> FIXED (a445c944bc)
- [WARNING] no unlisted out-of-$S stand-in --> FIXED (a445c944bc)
- [WARNING] mid-run kill_waiters must be the last arm --> FIXED (a445c944bc, then the sub-root in round 11)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] listed-pid shapes reachable by pid reuse --> FIXED (dc53f6350b, parentage check)
- [WARNING] arm order rule silent --> FIXED (dc53f6350b, the arm runs against its own sub-root)
- [WARNING] test-file branch uncontrolled --> FIXED (dc53f6350b, KG must die, KH must survive; CONTROLS measured)
- [WARNING] no whole-file run at HEAD --> FIXED (178/178 recorded)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, all DEFERRED
- [WARNING] the watchdog's listed-pid half is redundant there --> DEFERRED: harmless; the $S/ half still ends reparented waiters, and the EXIT trap needs both halves
- [WARNING] $S as a pgrep regex --> DEFERRED: the shape guard is a literal glob on the same $S/, so a foreign process cannot be hit
- [WARNING] Linux portability of the stand-ins --> DEFERRED to the PR's CI: the Linux shell shards run this file (it is not in tools/shell-macos-only.txt)
**Converged** - no new actionable findings.

### Also measured during the loop
- Defect 2 reproduced with a planted stray: `pgrep -o` picked it; with the fix the file passed 175/175 beside it.
- Defect 1 not reproduced; the sweep's coverage of it is reasoned, and stated so in the plan.
- Disclosed: one round-10 control was run against the real process table and KILLed every `--queued-args` waiter on the Mac for about 25 s (two colleagues' runs hit; told at once, both re-queued).

### NITs (non-blocking)
- [NIT] stand-ins are plain 60 s sleeps, so a run killed mid-arm can leave them up to 60 s
- [NIT] the source check is a text match on one spelling
- [NIT] the plan is long, with round-by-round history

### Strengths
- [STRENGTH] joiner_under finds the joiner by parentage, which removes the wrong-process pick at its root, with a control showing pgrep -o picks the stray
- [STRENGTH] every KILL in kill_waiters is gated on this run's own $S or on a listed pid that is still this shell's child, plus a shape check
- [STRENGTH] stand-ins use a fake script path, so no real queue scan on the Mac sees them
