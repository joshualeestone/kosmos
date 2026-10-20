---
method: challenge-loop
branch: filewatchdog-6668
diff_hash: 462569b10ae80c518a5a0e6de5edcbab50a4a97700649299313f4c129dbf5fbf
timestamp: 2026-10-20T11:56:58Z
subdir_audit: passed
iterations: 18
converged: true
---

# Challenge-loop proof: filewatchdog-6668 (kosmos#6668, a per-file wall-clock limit in tools/run-tests.sh)

A test file stalled in a blocking spawnSync held the shared machine's queue for 66 minutes. tools/run-tests.sh now
runs a watchdog outside node that stops any one test file past its limit (default 30 min, scaled by load, capped at
60 min by scaling), names it, and turns the run red; node's --test-timeout is on (scaled); the grep test that stalled
has a scaled 10 s timeout. Eighteen blind iterations alternated Sonnet and Opus. Rebased onto origin/main after
convergence (no overlap with main's 133 newer commits).

#### Iterations 1 to 6
- [WARNING] KILL used a stale snapshot (pid reuse): FIXED. [WARNING] watchdog lingered after Ctrl-C/TERM: FIXED.
- [WARNING] --test-timeout margin and N unmeasured: FIXED (measured: slowest file 388 s, slowest test 183.5 s).
- [WARNING] fixed test bounds fragile under load: FIXED (scaleBudget). [WARNING] a file finishing at the limit
  could be flagged: FIXED. [WARNING] N unscaled: FIXED (scaled, capped 60 min). [WARNING] claims stronger than
  code (trap on Ctrl-C, grep stall cause): FIXED.

#### Iterations 7 to 12
- [WARNING] node started through a non-exec version-manager shim would make the whole suite one "file": FIXED
  (one-level descent, shim arms). [WARNING] limits printed on green runs: FIXED (red-only record).
- [WARNING] limits claimed when the watchdog never started: FIXED ("off" lines). [WARNING] TERMed runner leaves
  node unlimited: stated limit.

#### Iterations 13 to 18
- [WARNING] loop ignored a stop mid-list: FIXED (red arm). [WARNING] once-per-file keyed on pid: FIXED (pid plus
  start time). [WARNING] flaky trap-window arm: REMOVED (trap proven only with the loop, stated).
  [CONVENTION] long comment lines: FIXED. Iteration 18: NITs only. Converged.
- After convergence three of iteration 18's NITs were applied (${sl:-} under set -u, a test cleanup guard, a
  comment); the exact diff was read in full by the orchestrator; no behaviour beyond those three lines changed.

### Final Ledger
- Iterations: 18. Touched tests 75/75 on the final tree (load 46); #4273, #2858, scale-export-5727 pass.
- Measured: one sampled full suite, per-file maximum 388 s (N=30 min is 4.6x). Full suite on this commit: queued.
- Stated limits: wall-clock age (host sleep counts); TERMed runner leaves node unlimited; a launchd-orphaned
  TERM-ignoring descendant is not KILLed; pid reuse in microseconds before TERM; the exit trap alone is not proven
  by a test. Owner Renet.
