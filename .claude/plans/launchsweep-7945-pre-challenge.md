---
pre_challenge: true
method: challenge-loop
branch: launchsweep-7945
diff_hash: 0d1a25881e1c106b78410b8be9d69ce558ba45b26a8168bf3d0e69528f1d4917
validation: passed
subdir_audit: passed
timestamp: 2026-11-05T04:32:00Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No (stopped at the operator's standing cap of 8 review rounds; round 8 found one WARNING, deferred on evidence, and one NIT, a doc comment fixed after the last blind review and not blind-reviewed)
**Total findings:** 37 (0 BLOCKERs, 15 WARNINGs, 2 CONVENTIONs, 20 NITs)
**Fixed:** 27 | **Deferred:** 4 | **Asked (awaiting user):** 0

Final validation after a rebase onto main: 27243 tests, 0 fail, validation PASSED (hash 0d1a25881e1c), subdir audit clean.
iOS: run-sweep.sh PASS 27/27, run-orb.sh PASS, ios.board-parity-7084.test.js 12/12, LaunchHandoverUITests 3/3 on
iPhone 17e iOS 27 (controls: centring removed -> ring 9 pt low, FAILS; round-6 layout at the largest text -> words
481 pt wide from x -45.5, FAILS).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] ios/tools/launch-sweep/main.swift:28 — launch mark was Reduce Motion's even ring; the moving sweep lightens it at the handover --> FIXED (4e7087f63a: SweepLogic.launchAt, SweepDots starts there)
- [WARNING] ios/LogicTests/run-sweep.sh — centring check grepped two tokens; a VStack shape passed --> FIXED (4e7087f63a: ordered shape, comments stripped)
- [CONVENTION] ios/README.md:266 — still said "still orb" --> FIXED (4e7087f63a)
- [NIT] AgentsView.swift — Today shares BoardStates --> FIXED (comment)
- [NIT] "every dot full size" wording --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ios/Kosmos/SweepDots.swift:19 — reaching drawn from two switch arms; starting -> live restarts the loop --> FIXED (a3e42059d3: one call site, checked)
- [WARNING] plan — simulator measurement claimed, not recorded --> FIXED (re-measured after the fix, recorded)
- [NIT] Today-on build centring --> DEFERRED: Today off in shipped builds
- [NIT] text size / Reduce Motion premises --> FIXED later (iterations 3 and 5)
- [NIT] render_side parse fragile --> DEFERRED: fails closed with a clear message

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] SweepDots.swift / AgentsView.swift — ring scales with text, launch picture does not --> FIXED (73b0c2c19f: scales: false)
- [WARNING] run-sweep.sh — 8 pt gap unguarded --> FIXED (73b0c2c19f)
- [NIT] call-site count missed self.reaching --> FIXED
- [NIT] run-sweep.sh header: tools read from this checkout --> FIXED
- [NIT] retry wait not centred --> FIXED (README)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] AgentsView.swift:445 — position never measured; a wrapper could move it with checks green --> FIXED (9e259d6474: LaunchHandoverUITests, control red at 9 pt)
- [WARNING] retry wait scales --> FIXED (README)
- [NIT] @State identity under conditional modifiers --> FIXED by the UI check
- [NIT] awk range fragility --> DEFERRED: fails loudly
- [NIT] old plan mentions LaunchOrb --> no change (history)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ContentView.swift:356 / ProjectsView.swift:829 — a notification launch opens Projects, which showed the orb --> FIXED (b8c00db079: ConnectingWait on both)
- [WARNING] SweepDots.swift — Reduce Motion switches looks at the handover --> FIXED (b8c00db079: SweepLogic.shown fades over 0.6 s)
- [WARNING] LaunchHandoverUITests — relies on the combined element frame --> DEFERRED: a different frame turns it red, not green; measured on iOS 27
- [NIT] doc comment, comment naming the check, long plan line --> FIXED

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ProjectsView.swift:831 — Projects centring unmeasured --> FIXED (2f7cf412d5: second UI check, passes)
- [WARNING] identity reset on return from the retry wait --> FIXED (README)
- [NIT] SweepDots doc stale --> FIXED
- [NIT] plan file naming --> no change (branch-named plans are the repo's practice)
- [NIT] CI opt-in flag --> confirmed set by ui-sample.sh

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] SweepDots.swift:316 — words fixedSize on a 20 pt ring run off screen at the largest text --> FIXED (f588c02845: words on the full frame, wrap; UI check at AX XXXL, control red)
- [NIT] Projects source check textual --> noted; the UI check measures it
- [NIT] plan's stale Reduce Motion line --> FIXED
- [NIT] launch screen cache on updated phones --> FIXED (README, and told Fleet Releases)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] AgentsView.swift — .connecting may follow .starting on a first connect --> DEFERRED: BoardClient.swift:1921 is the only place .connecting is set, inside .refused (a retried, refused hand-off)
- [NIT] SweepDots.swift:53 — "across the screen's width" (less 24 pt each side) --> FIXED (ceb273e753, comment only, NOT blind-reviewed)
- [NIT] UI check reads the combined element frame --> same deferral as iteration 5
- [NIT] fixed-order shape check is noisy on reorders --> accepted: fails safe

### NITs and residuals
- Not measured on a real iPhone. iOS caches launch screens; a phone updated from an earlier build may show the old one until a restart or reinstall.
- The rarer "Connecting to <Mac>" retry wait keeps its message layout and scaling ring.

### Strengths (across all iterations)
- One source for the launch picture and the wait's first frame (SweepLogic.launchAt / shown), pixel-checked PNGs.
- Placement measured on a running app with controls that fail, not only read from code.
