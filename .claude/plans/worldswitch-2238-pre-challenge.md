---
pre_challenge: true
method: challenge-loop
branch: worldswitch-2238
diff_hash: 566664158dc86d0944b850c9ac0c1ce2dd0709ac845264aaf2e05ffb29d7e120
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T17:04:04Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (iter 1 = the 6.0 validation fix-and-validate; iters 2-4 = fresh blind reviews)
**Converged:** Yes (iteration 4 returned zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 9 actionable (2 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs) + 5 NITs
**Fixed:** 9 actionable + 5 NITs | **Deferred:** 0 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
**New findings:** 1 BLOCKER
- [BLOCKER] web/index.html (CSS) - `.worldsw-restart` used `var(--text-footnote)`, an undefined token, so the declaration would be dropped --> FIXED (--text-caption).

#### Iteration 2 (first blind review)
**New findings:** 1 BLOCKER, 1 WARNING, 1 CONVENTION
- [BLOCKER] server.js - the auto-restart mechanism was WRONG (verified against install/setup.sh + install/kosmos): the installed board is NOT a launchd KeepAlive job (RunAtLoad, no KeepAlive; `kosmos start` daemonises via nohup and exits; cmd_start no-ops on a healthy port), so `launchctl kickstart -k` re-ran `kosmos start` and did nothing while the UI reported success --> FIXED by removing the auto-restart (POST /api/board/restart + boardRestartLabel + its test) and shipping the switch + HONEST guidance; auto-restart deferred as the documented #2238 follow-up. server.js is now unchanged vs origin/main.
- [WARNING] web/index.html - worldswAwaitBoard reloaded on the first 200 without a boot-token check --> moot (the restart/await path was removed).
- [CONVENTION] web/index.html - ARIA: role=list with a role=button child is invalid list structure --> FIXED (superseded by the native-button rework in iter 3).

#### Iteration 3 (second blind review)
**New findings:** 2 WARNINGs, 1 CONVENTION (+ 2 NITs)
- [WARNING] web/index.html - role=menu without the menu keyboard contract (no arrow-key/roving focus) --> FIXED: switched to NATIVE `<button>` rows in a role=group container (keyboard-operable with no ARIA contract to implement).
- [WARNING] web/index.html - the post-switch status banner persisted on menu reopen (stale, possibly-false state) --> FIXED: worldswClose clears it.
- [CONVENTION] web/index.html - comment claimed role=button/listitem while code set role=menuitem --> FIXED (comment corrected; plan Investigation's wrong "launchd KeepAlive" line corrected too).
- [NIT] focus fell to <body> after the refetch rebuilds rows --> FIXED (focus the switcher trigger).
- [NIT] role=status text set while hidden --> FIXED (say() unhides before setting text).

#### Iteration 4 (third blind review)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs.
**Converged** - no new actionable findings. All 3 NITs applied as polish:
- [NIT] banner used the captured row name, not the server-returned world.name --> FIXED (prefer okBody.world.name).
- [NIT] the 404 failure branch (refetches) did not restore focus like the success path --> FIXED.
- [NIT] stale worldAddSubmit comment ("switching deferred to slice 2b") --> FIXED.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html | undefined CSS token --text-footnote | FIXED | --text-caption |
| 2 | 2 | BLOCKER | server.js | auto-restart mechanism wrong (board not KeepAlive) | FIXED | removed auto-restart; honest guidance; deferred follow-up |
| 3 | 2 | WARNING | web/index.html | await-board no boot token | FIXED | moot (path removed) |
| 4 | 2 | CONVENTION | web/index.html | role=list + button child invalid | FIXED | superseded by native buttons |
| 5 | 3 | WARNING | web/index.html | role=menu keyboard contract missing | FIXED | native <button> rows in role=group |
| 6 | 3 | WARNING | web/index.html | stale banner on reopen | FIXED | worldswClose clears it |
| 7 | 3 | CONVENTION | web/index.html | comment/plan drift | FIXED | corrected |
| 8 | 4 | NIT | web/index.html | banner name vs server world.name | FIXED | prefer world.name |
| 9 | 4 | NIT | web/index.html | 404 focus + stale create comment | FIXED | focus restore + comment |

### Outstanding questions (ASKED)
None.

### Deferred (documented, not a challenge finding)
- The in-app AUTO-restart of the board ("go to it" completes without a manual restart) is deferred as the #2238 follow-up: the installed board is a detached, non-launchd-owned process, so a correct restart needs a detached `kosmos restart` helper + a client boot-token reconnect, which is fleet-sensitive and only verifiable by a LIVE board restart on a real install (not runnable on the shared box). This branch ships the SELECT fix + honest load-after-restart guidance.

### Strengths (across iterations)
- Native <button> rows: keyboard-operable for free, no ARIA menu/roving contract to get wrong; world names via textContent only.
- worldswSwitch re-entrancy correct (WORLDSW_SWITCHING set before try, cleared in finally on every path).
- Failure classification faithfully matches the #2212 endpoint contract (404/409/generic).
- The render check is non-vacuous + perturbation-proven (its load-bearing arms red on the pre-fix read-only page).
- Emit-count tripwires bumped exactly (+1 finding-emit, +1 catch/launch) for the one new check.
