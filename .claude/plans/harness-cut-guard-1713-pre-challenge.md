---
pre_challenge: true
method: challenge-loop
branch: harness-cut-guard-1713
diff_hash: 795b4cd3b356e3d087df53283dc5876e1b21513fb855c387d204335459a05c8a
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T01:58:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 4 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs)
**Fixed:** 2 | **Deferred:** 2 | **Asked:** 0

kosmos#1713. The install harness (tools/test-install.sh) refuses to START during
a cut, but a cut started while a harness was ALREADY running was unprotected --
they collide on the install gate's fixed port, and the failed step is blamed on
the cut. Added a symmetric guard `kosmos_refuse_if_harness_live` to
tools/lib/cut-guard.sh, mirroring the two existing guards exactly, wired into
tools/release.sh at the cut's start (gated by KOSMOS_CUT_IGNORE_HARNESS), and
extended tools/test-cut-guard.sh.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] test-cut-guard.sh -- the "mention" arm was vacuous: `bash -c 'sleep 4' tools/test-install.sh` triggers bash's single-command exec optimization, replacing the shell with `sleep 4` so the string leaves argv and pgrep finds nothing; the arm passed on an empty process table, not by the filter --> FIXED (510c4703): compound `-c` body so the string survives, plus an assertion that the mention is visible to pgrep.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
- [NIT] test-cut-guard.sh -- the anti-vacuity assertion used an unanchored `grep -q "$mention"`, so a substring pid could false-satisfy the very check that exists to prevent vacuity --> FIXED (8c915c98): anchored `grep -qE "^$mention "`.
- [NIT] test-cut-guard.sh -- sleep-based timing could flake if fork/scheduling exceeds 1s --> DEFERRED: fails in the safe direction (a false FAIL, never a false pass) and is identical to the already-merged release.sh end-to-end arms; changing it would diverge from the established pattern.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** -- the one NIT is harmless test hygiene:
- [NIT] test-cut-guard.sh -- `kill "$harness"` targets the two-command subshell wrapper, not its inner `bash test-install.sh`, so the fake harness lingers ~3s --> DEFERRED (reviewer: "harmless in practice... Not worth changing"): it self-terminates, is the last arm, the EXIT trap cleans its dir, and a leftover only makes the NEXT run SKIP the end-to-end (safe, never a false pass).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | test-cut-guard.sh | vacuous mention arm (exec-optimized string) | FIXED | 510c4703 |
| 2 | 2 | NIT | test-cut-guard.sh | unanchored anti-vacuity pid grep | FIXED | 8c915c98 |
| 3 | 2 | NIT | test-cut-guard.sh | sleep timing flake risk | DEFERRED | inherited, fails safe |
| 4 | 3 | NIT | test-cut-guard.sh | kill targets subshell wrapper | DEFERRED | harmless, self-terminates |

### Outstanding questions (ASKED)
None.

### Validation
`yarn test:shell` (all checks passed -- includes test-cut-guard.sh with all the
new harness-guard arms, 20/20, plus `bash -n` of release.sh and cut-guard.sh) and
the full `yarn test` (3348 tests, 0 fail) both green.

### NITs (deferred, non-blocking)
- [NIT] test-cut-guard.sh -- sleep-based timing, fails safe, inherited from the sibling arms (iteration 2)
- [NIT] test-cut-guard.sh -- kill targets the subshell wrapper; the fake harness self-terminates in ~3s (iteration 3)

### Strengths (verified by the reviewers)
- The new guard is a faithful structural mirror of the STRONGER sibling kosmos_refuse_if_browser_run_live: it uses the #1391-fixed _kosmos_drop_self_subtree (the subtree walk), not the cut guard's weaker single-pid grep -v -- correct for a future in-harness caller.
- rc-normalization and posture match the template: pgrep status read off its own line before the pipe; rc>=2 (unanswerable probe) -> refuse (fail-safe); the robust filter matches only a real `bash tools/test-install.sh`, not a mention.
- The wiring is at the cut's top before any fork, after the line-33 "started" logging contract, gated on the correctly-named independent KOSMOS_CUT_IGNORE_HARNESS (distinct from the pre-existing KOSMOS_HARNESS_IGNORE_CUT).
- The end-to-end tests invoke the guard from a SEPARATE process so the spawned harness/mention are siblings, not descendants -- the only setup that exercises the filter/detection rather than masking it with self-exclusion; the anti-vacuity assertion (anchored) proves the mention is really in the process table.
- No em dashes in any added line.
