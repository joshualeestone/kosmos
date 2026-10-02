---
pre_challenge: true
method: challenge-loop
branch: win-settings-front-3324b
diff_hash: 1e72ef6ac357a30e68040d9bdd917741680194a2aac659fff6a2d65cbbaececc
validation: failed (environment: validation-log helper cannot run on this Windows box, no npm/yarn on PATH; its four steps are three echo no-op scripts plus the macOS-targeted full suite, which CI runs; affected tests run directly instead, 43/43 pass)
subdir_audit: passed
timestamp: 2026-10-02T16:15:25Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12. Iterations 1-10 ran on branch win-settings-front-3324 (PR #5035); the
change then moved to this branch (repo rule: no commits onto a branch with an open PR) and
iterations 11-12 ran here on the identical code plus their fixes. Iteration 1 = the 6.0
initial-validation pass; iteration 8 = a BLOCKER found by the orchestrator's live rig.
**Converged:** Yes (iteration 12 returned NITs only)
**Total findings:** 1 initial-validation BLOCKER, 1 rig BLOCKER, 13 WARNINGs, 3 CONVENTIONs (NITs listed below)
**Fixed:** 15 | **Deferred:** 3 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
- [BLOCKER] initial-validation: helper failed, neither yarn nor npm on PATH --> DEFERRED: environment, not the diff. type-check / lint-fix / build are echo no-ops in package.json; `test` is the full suite CI runs. Substitute: affected tests run directly with the runtime node and the no-schtasks preload at every iteration. Merge only on green CI.

#### Iteration 2
- [WARNING] SW_RESTORE un-maximizes a maximized Settings --> FIXED (restore only when IsIconic)
- [WARNING] comment wrongly said a non-detached child survives its parent --> FIXED
- [WARNING] test asserted the constant, not what reaches spawn --> FIXED (setSpawnForTests seam below the live gate)
- NITs: visibility checked before class name (applied); minimized case in weakest part (applied)

#### Iteration 3
- [WARNING] engine/machine.js comment still said "detached" --> FIXED
- NITs: loosen the IsIconic assertion (applied); cloaked frames on other virtual desktops

#### Iteration 4
- [WARNING] no board-launched proof of the real spawn --> FIXED (plan clarified; PR says Addresses, issue closes after the board-level check)
- [WARNING] suspended CoreWindow detached from frame -> silent no-op --> DEFERRED: the suggested "raise any empty frame" fallback could raise another app's window; a no-op is the pre-fix state
- NITs: compare whole options + record unref (applied); GW_CHILD walk

#### Iteration 5
- [CONVENTION] plan name lacked the timestamp suffix --> FIXED (renamed)
- NITs: zero-pid guard (applied); terse C# names; redundant asserts

#### Iteration 6
- [WARNING] SilentlyContinue hides an Add-Type compile failure --> FIXED (win32-only compile test; planted typo goes red)
- NITs: break only when Settings is actually in front (applied); -WindowStyle comment (applied)

#### Iteration 7
- NITs only (PowerShell loop not parse-checked; late retry; identity assert) -- loop converged here the first time

#### Iteration 8 (orchestrator live rig, after PR #5035 opened)
- [BLOCKER] engine/win32explorer.js — cold Settings launch ended with NO window focused, every run (old code: Settings focused). Cause, logged: SystemSettings briefly owns a temporary window of the frame's class (its MainWindowHandle); the fallback raised it mid-handover --> FIXED (skip self-owned frames, drop the MainWindowHandle fallback, stand down when Settings is in front); cold 4/4 clean after

#### Iteration 9
- [WARNING] test header said nothing touches the machine; compile test does --> FIXED (header names the exception)
- [WARNING] unbounded raise retries can flash the taskbar ~40 times --> FIXED (max 3 attempts)
- NITs: source-spelling assertions; host stand-down trade-off; windowsHide libuv dependency

#### Iteration 10
- [CONVENTION] commits pushed onto a branch with an open PR (CLAUDE.md branch rule) --> FIXED (moved to this branch; #5035 to be closed pointing here)
- [WARNING] stand-down for ApplicationFrameHost left Settings behind any packaged app --> FIXED (narrowed to frame or SystemSettings; Calculator in front: old wide check failed, narrow raised; cold 5/5 clean without the host check; negative-control test)
- [WARNING] test arms the live gate --> FIXED (comment + seam asserted before arming)
- [CONVENTION] unexplained 3 tries / 120 ms / 5 s --> FIXED (comment)
- NITs: looser change-detector patterns (applied); duplicate P/Invoke comment (applied)

#### Iteration 11
- [WARNING] only the C# is compile-checked; the PowerShell loop could hold a silent syntax error --> FIXED (parse the whole script; planted syntax slip goes red)
- NITs: typeof assert moved above the seam call (applied); windowsHide comment made consistent (applied); fg-0 case comment (applied)

#### Iteration 12
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | BLOCKER | validation helper cannot run (no npm/yarn) | DEFERRED (environment; targeted tests; CI) |
| 2 | 2 | WARNING | SW_RESTORE un-maximizes | FIXED |
| 3 | 2 | WARNING | wrong child-lifetime comment | FIXED |
| 4 | 2 | WARNING | spawn options untested at spawn | FIXED |
| 5 | 3 | WARNING | stale detached comment in machine.js | FIXED |
| 6 | 4 | WARNING | no board-launched proof | FIXED (Addresses, board check owed) |
| 7 | 4 | WARNING | suspended frame silent no-op | DEFERRED (fallback could raise wrong app) |
| 8 | 5 | CONVENTION | plan name lacked timestamp | FIXED |
| 9 | 6 | WARNING | silent C# compile failure | FIXED |
| 10 | 8 | BLOCKER | cold launch left no window focused | FIXED |
| 11 | 9 | WARNING | test header claim | FIXED |
| 12 | 9 | WARNING | unbounded raise retries | FIXED |
| 13 | 10 | CONVENTION | push onto open-PR branch | FIXED (this branch) |
| 14 | 10 | WARNING | host stand-down vs other packaged apps | FIXED |
| 15 | 10 | WARNING | live gate armed in test | FIXED |
| 16 | 10 | CONVENTION | magic numbers | FIXED |
| 17 | 11 | WARNING | PowerShell loop not syntax-checked | FIXED |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, latest)
- change-detector assertions can be dodged by re-spelling (iteration 12)
- resetForTests forces the gate false instead of restoring the prior value (iteration 12)
- $sp keeps the last pid tried when no frame matched (only read on a match) (iteration 12)
- the post-raise check can spend a try while a minimized window restores (iteration 12)
- cloaked frames on other virtual desktops (iterations 3, 5)

### Strengths
- both root causes measured on the box and documented where they apply
- spawn seam below the live gate; Windows-only compile + parse tests with negative controls
- frame matched by host ownership + Settings child, never by localized title
- plan names its weakest part; Addresses #3324 until the board-level check passes
