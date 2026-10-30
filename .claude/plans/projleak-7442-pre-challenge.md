---
pre_challenge: true
method: challenge-loop
branch: projleak-7442
diff_hash: ac00ed1dee0924a15cb2ef71a9fb105bc63f1643300ad694f2f2a3b2ef83dd9a
validation: focused (server.projects.test.js 182/182 with nothing left in TMPDIR; the 33 test-file audits plus test-support.tmpscope: 717 pass, 0 fail); a with/without harness proves the mechanism; full suite left to CI
subdir_audit: passed (no subdir CLAUDE.md in the diff)
timestamp: 2026-10-28T06:00:11Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes (round 1: no BLOCKER, no WARNING)
**Fixed:** the one NIT taken | **Deferred:** one NIT, reason below | **Asked (awaiting user):** 0

The change is one require (test-support/tmpscope) at the top of one test file, plus its comment. Test-only.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**What the reviewer verified, each by reading the code or by a run:**
- The exit sweep runs from process.on('exit'), after which no timer callback can run.
- The three writers named on the card (prompternudge, guidestate, restartnote via store.saveFlushed) are synchronous, so no write is in flight during the sweep.
- Nothing this file loads registers its own SIGTERM handler, so a run-tests watchdog TERM still sweeps and re-raises.
- No child process of this file outlives it: reveal is stubbed, tmux is the fake script, the Claude binary is /bin/echo, DRY_RUN=1.
- The require precedes every os.tmpdir() read (SANDBOX, the claude config path).
- tools/lib/test-leak-guard.sh lists only the run root's top level, so a swept kts- folder is absent and a surviving one is attributed by its .kts-owner file.
- A run with TMPDIR at a fresh directory: 182/182, and the directory was empty after the run and 5 seconds later; a probe showed TMPDIR at exit was the file's own kts- directory.
- The deliberate trade, the same as in 157 other tmpscope files: a future test here that forgets its own cleanup is swept, not reported.

**Findings:**
- [NIT] the comment said the sweep runs "after every timer this file started", which is not true of a child process that outlives the file (#6362) --> FIXED (the comment names in-process timers and #6362, and says none here outlives it)
- [NIT] the after hook's rmSync now mostly overlaps the exit sweep --> DEFERRED: kept on purpose, it frees the space early (reviewer: no change needed)
Converged.
