---
pre_challenge: true
method: challenge-loop
branch: signinwatch-7498
diff_hash: ad72a416b4e2b654e9d9a6b5475a254100270f594a7d935e27cdd8befacae85d
validation: focused (engine/win32board.start-at-sign-in: 19 pass, after the rebase onto ad3250e431); 320 related files (win32board, start-at-sign-in, every server importer) on the pre-rebase tree with the review-3 fixes: 4112 tests, 3932 pass, 179 skipped, 1 fail, server.attachment-stream-6734's full-disk arm, which passed 33/33 alone three times and is filed as the load flake #7509; the rebase brought in only server.js keep-awake lines, server.js loads; full suite left to CI.
subdir_audit: passed (no subdir CLAUDE.md in the diff)
timestamp: 2026-10-28T18:48:15Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (round 4: no BLOCKER, no WARNING)
**Fixed:** every BLOCKER and WARNING | **Deferred:** listed below with reasons | **Asked (awaiting user):** 0
Every fix carries a test; each new test was mutation-checked (mutant applied, the expected test red, the file restored from a copy).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] the screen ignores the route's `watchdog` answer --> SPLIT to #7504 (needs-browser); #7498 narrowed to the engine and route, said on the card
- [WARNING] a missing task was matched only by English text --> FIXED (the label-free task list; German not-found test)
- [WARNING] ensureWatchdog called the anchorer, which rewrites the fleet pointer and boot shim --> FIXED (anchor folder and its node.exe only; a test whose anchorer throws)
- [WARNING] no budget across the /Query and /Create --> FIXED (one schtasks budget, NO_TIME_LEFT)
- [WARNING] an already-on switch never healed a missing watchdog --> FIXED
- [WARNING] the registered definition was not asserted --> FIXED (XML read: interpreter, shim, working folder, user); source-checkout, missing node.exe, failed /Create tests
- [NIT] the 'could not tell' detail wording; 'present' does not check the shim file --> noted

#### Iteration 2
**Reviewer model:** opus
- [WARNING] the task-list read was outside the budget --> FIXED (every schtasks call through one `ask`)
- [WARNING] three tests could not fail --> FIXED (the reviewer's 3 surviving mutants now red)
- [NIT] an older build could rewrite a newer watchdog shim; ensureWatchdog exported without its own live-exec guard; the o.anchorDir seam --> DEFERRED (below)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the whole request could block about 80 s --> FIXED (request-wide deadline of two schtasks timeouts from the request's start; test where the /Change spends it)
- [WARNING] no test that the list read is inside the budget --> FIXED (German slow-query test: no list read, no /Create)
- [WARNING] no test of the /Create's own timeout --> FIXED (the runner records it; 15 s query gives at most 5000 ms)
- [NIT] a German error with the watchdog listed said "could not tell" --> FIXED (present)
- [NIT] a list read cut by no time left gave the wrong wording --> FIXED

#### Iteration 4
**Reviewer model:** opus
- [NIT] the deadline comment read as a bound on the whole request --> FIXED (reworded: the board task's three calls stay bounded as before)
- [NIT] older build rewriting a newer shim --> DEFERRED (below)
- [NIT] the BUNDLE fixture's exists() is true for every path --> DEFERRED: the missing-node.exe test flips it and is mutation-checked
Converged.

### Deferred, with reasons
- An older build serving Settings could rewrite a newer build's watchdog shim when the task is missing. Needs an older board actually serving Settings (the boot's hand-off normally prevents it) AND a missing watchdog; the next newer boot rewrites the shim.
- ensureWatchdog exported without its own live-exec guard: its only caller (setStartAtSignIn) is gated, and `run` refuses schtasks from any test process.
