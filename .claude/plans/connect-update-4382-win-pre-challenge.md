---
pre_challenge: true
method: challenge-loop
branch: connect-update-4382-win
diff_hash: 3deb0234007a1ef0d7fe126c16cc9ca8a664259e14e4184c801ef4907d14852f
validation: passed (targeted: 12 branch and launcher test files, 440 tests, through the no-schtasks preload on Windows; the one failure, #5548 in engine.reachable.test.js, fails identically on clean origin/main on this box; full suite runs in CI)
subdir_audit: passed
timestamp: 2026-10-14T02:09:02Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes (iteration 12: zero NEW findings after deduplication, no ASKED findings)
**Total findings (iterations 9-12, recorded in this run):** 0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs, 16 NITs
**Fixed:** 6 | **Deferred:** 1 | **Asked (awaiting user):** 0

Note on iterations 1-8: the box crashed (BSOD) during iteration 8, and the session holding the
ledger for iterations 1-8 was lost with it. Their fixes are the commits "address review
findings" and "address challenge-loop iteration 2..8 findings" on this branch; iteration 8's
fixes were found uncommitted in the working tree after the crash, checked (files parse, the
committed Kosmos.exe reproduces from KosmosLauncher.cs and is validly signed, 262 of 263 tests
pass with 1 skip), and committed as iteration 8. Each later iteration was a fresh, blind agent.

### Per-Iteration Breakdown

#### Iterations 1-8
Ledger lost in the crash; fixes are in the commits named above.

#### Iteration 9
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] tools/windows/KosmosLauncher.cs UpdateOfferNote: the offer bar said "Updates are off" for every `newer` answer, also a held version, a newer release after the one picked, or an automatic install that could not start --> FIXED (neutral wording "Kosmos X is ready. Press Update to install it.", engine doc lists every `newer` case, test pins the wording)
- [WARNING] tools/windows/KosmosLauncher.cs StopBoardInBackground: looks start only after a connect stop that held --> DEFERRED: kept deliberately. A stop that did not hold may leave the board's logon task on, and on a connect computer the engine's B0 connect precondition stands in for the board-task rule, so nothing else keeps that task from starting a board under a swap. The person is told and the next launch retries. Reasoning now in a code comment and the plan.
- [WARNING] tools/windows/KosmosLauncher.cs UpdateOnDiskFreshMs (30 min) shorter than the 40-minute give-up, so a slow run past 30 minutes no longer held Run agents --> FIXED (45 minutes, comment ties the two, test asserts fresh > give-up)
- [NIT] engine/win32connectupdate.js header did not list the unversioned failed answer (fixed with the doc change)
- [NIT] a separate answer word for "not seen to finish" (taken in iteration 11 as `pending`)
- [NIT] Not now / Update visibility on a bar already shown when a background look starts

#### Iteration 10
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
- [WARNING] KosmosLauncher.cs LookForUpdate: a given-up look that later answered `updated` while another run was in flight was dropped, so a later look could start a second update under the window --> FIXED (lateInstall, recorded once the in-flight run is done; test pin)
- [WARNING] KosmosLauncher.cs LookForUpdate: a hung, given-up look kept Kosmos.exe alive (foreground thread) after the window closed --> FIXED (the give-up marks the thread background; the engine run is its own process either way)
- [NIT] engine/win32connectupdate.js run() doc did not list helperOptions --> fixed
- [NIT] tools/windows/README.md retry sentence understated (also after a refused look) --> fixed
- [NIT] engine/win32apply.js over-long comment line --> rewrapped
- [NIT] engine/win32update.js applyCli: boardAnswers is from the probe that chose the branch, no re-probe (H2 still covers a later board)

#### Iteration 11
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] KosmosLauncher.cs AfterConnectUpdate / engine/win32connectupdate.js: an update or rollback not seen to finish left the window free to look again, and a second update's cleanup could delete the moved-aside copy the window runs from --> FIXED (new engine answer `pending`; the window marks itself Unsettled: no further look, no Update or Roll back, a note to reopen Kosmos; a given-up look's `pending` is recorded too; engine and probe tests)
- [NIT] UpdateNotStartedNote's "Try again in a few minutes" contradicted refusals that already say what to do --> fixed (only added when there is no reason)
- [NIT] "did not finish ... may still finish" wording on a rollback not seen to finish --> fixed by `pending` and its own note
- [NIT] actions and relaunch kinds are bare strings, not an enum

#### Iteration 12
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Duplicates of prior findings:** 1 (the `stopped` gate, deferred in iteration 9)
**Converged**: no new actionable findings.

### Final Ledger (iterations 9-12)

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 9 | WARNING | KosmosLauncher.cs UpdateOfferNote | Offer bar claimed updates are off for every newer | FIXED | 8874f0d01 |
| 2 | 9 | WARNING | KosmosLauncher.cs StopBoardInBackground | Looks gated on a stop that held | DEFERRED | Task may still be on; engine B0 does not cover it; told and retried next launch |
| 3 | 9 | WARNING | KosmosLauncher.cs UpdateOnDiskFreshMs | Freshness shorter than the give-up | FIXED | 8874f0d01 |
| 4 | 10 | WARNING | KosmosLauncher.cs LookForUpdate | Given-up install dropped while another run in flight | FIXED | c41f0fdf5 |
| 5 | 10 | WARNING | KosmosLauncher.cs LookForUpdate | Hung look kept Kosmos.exe alive after close | FIXED | c41f0fdf5 |
| 6 | 11 | WARNING | KosmosLauncher.cs AfterConnectUpdate | Update not seen to finish could lead to a second update under the window | FIXED | 033d3a9c7 |
| 7 | 12 | WARNING | KosmosLauncher.cs StopBoardInBackground | Same as #2 | DEFERRED | Duplicate of #2 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, not fixed)
- [NIT] KosmosLauncher.cs ShowUpdateBar: Not now and Update stay on a bar already shown when a background look starts; Update then says a run is under way (iteration 9)
- [NIT] engine/win32update.js applyCli: boardAnswers is the branch-choosing probe, not a fresh one; the helper's H2 probe covers a board that starts later (iteration 10)
- [NIT] KosmosLauncher.cs: actions and relaunch kinds are bare strings rather than an enum (iteration 11)
- [NIT] KosmosLauncher.cs AfterConnectUpdate: an asked run that comes back Unknown or Refused resets an hourly retry to daily (iteration 12)
- [NIT] engine/win32apply.js: the no-board skip log says "connects to another computer" also for an unreadable mode file (iteration 12)
- [NIT] engine/win32update.js applyCli: a non-Kosmos program on the port gets board-task wording, not run()'s clearer sentence (iteration 12)
- [NIT] engine/win32connectupdate.js: the rollback-hold doc comment is separated from heldPath by a one-line comment (iteration 12)
- [NIT] engine/win32connectupdate.js cliMain: the thrown-run fallback result has no note field (iteration 12)

### Strengths (across iterations)
- Reuses the board's own look, consent, updater, rollback and outcome wait end to end; the only fork is a narrow B0 precondition re-read at B0 (iterations 9-12)
- The board is probed again right before anything starts; unfinished journals go to begin({ resumeOnly }) (iterations 10-12)
- The window's decisions are pure functions tested through a probe compiled beside the launcher; the engine tests run the real helper in a sandbox with a board-task control (iterations 9-12)
- The rollback hold is written before the outcome wait and released inside the helper's write guard; rollback limited to connect-ready builds (iterations 10-12)
- The committed Kosmos.exe is rebuilt and signed with every launcher change and reproduces from source (iteration 12)
