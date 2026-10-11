---
pre_challenge: true
method: challenge-loop
branch: plusloader-5785
diff_hash: f02130c473b8275c7c8c4f4592f1427b5fccadf24122829ae572c1ad0171ac95
validation: passed
subdir_audit: passed
timestamp: 2026-10-10T23:25:41Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10 blind reviews, alternating Opus and Sonnet (5 each)
**Converged:** Yes. Iteration 10 found nothing new. The closing gate (6j) then failed once on the browser-check surface
gate (below), fixed by per-check trailers on an empty commit (no code change), and passed on the hash above.
**Total actionable findings:** 1 BLOCKER, 22 WARNINGs, 1 synthetic final-validation BLOCKER, many NITs
**Fixed:** 19 | **Deferred:** 5 | **Asked (awaiting user):** 0

**Self-generated (6c-bis):** not classified by blame this run; recorded as unknown, not estimated. Most findings from
iteration 2 on were in earlier iterations' fixes (the hold and its epoch/flag handling), so the loop reviewed its own
output. Origin is BRANCH in every row below as the fail-safe value, not as a measurement.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] web/index.html plusSiDoRegister: a stale answer could paint over a newer sign-in during the hold --> FIXED 05ce5e816 (epoch re-check after the hold)
- [WARNING] the registering flag cleared before the hold, so the status tick could flash the connected view --> FIXED 05ce5e816
- [WARNING] a Sign out mid-connect left the loader drawing in a hidden card --> FIXED 05ce5e816 (plusSiClear stops it)
- [WARNING] three Kosmos+ browser checks would wait out the 4.4 s hold --> FIXED 05ce5e816 (restart seam set per page)
- [WARNING] a test pinned the wrong ordering; tests are source-only --> FIXED 05ce5e816 (ordering); source-only DEFERRED: repo convention, browser checks carry behaviour

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] fast refusals were held 4.4 s under "takes half a minute" --> FIXED 75f9434b2 (only a success holds)
- [WARNING] the registering flag was set only for the automatic register --> FIXED 75f9434b2

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the design shot could be repainted away by the status tick --> FIXED 1945d7731 (flags set as a real register, and the shot fails if repainted)
- [WARNING] a typed-name connect's mixed alignment was never shot --> FIXED 1945d7731 (centred only for the automatic connect; second screen shot; Mona Lisa approved)

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] a thrown register left the registering flag set --> FIXED f4e83a58c
- [WARNING] the resend epoch bump does not clear the register --> DEFERRED: unreachable during a register; documented, later pinned by a test (iteration 8)
- [WARNING] "about half a minute" is a fixed figure --> DEFERRED: Mona Lisa's copy; "about"; measured ~33 s; the plan says it is typical, not a promise

#### Iteration 5
**Reviewer model:** opus
- [WARNING] the shot set the wrong flag for a not-signed-in board (PLUS_SIGNIN_ACTIVE) --> FIXED 7210ca136
- [WARNING] the flag was still owned-only during the wait itself --> FIXED 7210ca136

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] a stale answer cleared a newer register's flag --> FIXED 15af85e53 (only the owning register clears it)
- [WARNING] resend epoch bump (dup of iteration 4) --> DEFERRED as above

#### Iteration 7
**Reviewer model:** opus
- [BLOCKER] render-plus-signin-3478's #4608 arm still asserted the small ring and no canvas during a connect --> FIXED 79188b606 (asserts the big loader, centred, the note, and that all of it goes on failure)
- [WARNING] a comment gave a reason that had stopped being true --> FIXED 79188b606
- [WARNING] plusSiEnter cleared state without bumping the epoch, so a held success could land on a fresh email step --> FIXED 79188b606

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] the note was not announced to screen readers --> FIXED 8c4308481 (then 9)
- [WARNING] the epoch invariant was enforced only by a comment --> FIXED 8c4308481 (a test)
- [WARNING] RESTART_HOLD_MS declared later in the script --> DEFERRED: the function runs only after the script has loaded, as the restart screen's use already does

#### Iteration 9
**Reviewer model:** opus
- [WARNING] unhiding a status region is not announced --> FIXED cde33af44 (always present and empty; text set on start)
- [WARNING] the epoch test skipped the resend by a guessed function name --> FIXED cde33af44 (skips by its own code)
- Mona Lisa's notes folded in the same commit: one "Signing in...", the shot fires an input event (6/32).

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 (resend coupling and the success hold are earlier deferrals). Converged; went to 6j.

#### Final validation (6j), first run (cde33af44)
- [BLOCKER] final-validation: the browser-check surface gate (#2518) flagged render-plus-company-5628 and render-plus-asks-signin-4610 (token plus-state2) and render-restart-screen-4343 (token restart-back, only in a CSS comment) --> FIXED ff050f8f3 with per-check trailers. The two Kosmos+ checks were run on the branch and pass (exit 0, no FAIL lines); the gate re-run passes.

#### Final validation (6j), second run (ff050f8f3)
Passed on ff050f8f3: node 18671 tests, 0 fail; shell part passed; EXIT=0 at 18:25 CDT (hash f02130c4); subdir audit rc=0.

### Also on the record
- Measured cause (on the card): a ~33 s connect, 24 s of it the coordinator's fixed ACME DNS settle.
- Browser checks run on the branch and passing: render-plus-signin-3478, render-plus-bought-4756, render-plus-signin-enter-0929, render-plus-company-5628, render-plus-asks-signin-4610.
- Design shots reviewed by Mona Lisa: plus-signing-in and plus-signing-in-name.
- Each key fix's test was checked to fail when the fix is reverted (spot checks per iteration).
