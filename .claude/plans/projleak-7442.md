# projleak-7442: server.projects.test.js leaves no aw-projects folder (#7442)

## Why
A full suite run failed only on the #4273 temp-leak check: one `aw-projects-*` folder. The leftovers held only files the
board's own timers write (prompter-nudges.json, board-alive.json, setup-guide-state.json), so a timer re-created the
folder after the file's `test.after` rmSync. Intermittent, under a loaded full run.

## Call
Require `test-support/tmpscope` first in the file (as 157 other test files do), so every temp dir the process makes
lives inside a per-process `kts-` directory removed at process exit, after every in-process timer.
Rejected: stopping the board's timers before the rmSync (they were not traced, and a timer added later would bring the
leak back; tmpscope covers any of them).
Weakest premise: no child process of this file outlives it (tmpscope cannot sweep after exit, #6362). Checked by the
reviewer: reveal is stubbed, tmux is the fake script, DRY_RUN is set.
Accepted trade (the same as every tmpscope file): a future test here that forgets its own cleanup is swept silently.

## Evidence
- Mechanism, both arms, a scratch harness outside the repo (remove in `after`, then a timer re-creates the folder):
  without tmpscope 1 aw-projects folder left; with tmpscope 0.
- server.projects.test.js 182/182 with TMPDIR at a fresh directory: nothing left after the run.
- The 33 test files that audit every test file, plus test-support.tmpscope and this file: 717 pass, 0 fail (1 skipped).
- The race itself was not reproduced on demand (it needs a loaded full run); the fix is proven on the mechanism.

## Review
- Round 1 (opus): CONVERGED, no blocker or warning. Verified the three writers are synchronous (no write in flight at
  the exit sweep), the require precedes every os.tmpdir() read, and run-tests.sh's leak guard attributes a surviving
  `kts-` folder by its owner file. Nit taken: the comment says "in-process" timers and names #6362.
