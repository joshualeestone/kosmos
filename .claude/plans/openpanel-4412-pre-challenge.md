---
pre_challenge: true
method: challenge-loop
branch: openpanel-4412
diff_hash: a54ae6d261ddb4cef45f55e3aa5c83d1c9e01f3686917d43b882a955be97056c
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T00:02:27Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 (blind reviews alternating opus and sonnet, starting with opus)
**Converged:** Yes (iteration 6: no BLOCKER, WARNING or CONVENTION; NITs only)
**Independent review outside the loop:** Baron reviewed an early head (0f7e688) and returned GO with two NITs (a silent 5 s after a drop, a late panel's answer ignored); both are addressed or named below.
**Deferred:** 2 (listed below). **Asked:** 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] tools.filepanel-gate.test.js - the new required lines were not pinned (a 134 exit fails either way) --> FIXED (each new line dropped at exit 0 must fail and be named; mutation checked)
- [WARNING] native-app/main.swift - the real panel's keep-it-up rule was never exercised --> FIXED (openPanelStillUp is a function; the selftest prints all four cases and the gate requires them; mutation visible&&appActive exits 1)
- [WARNING] native-app/main.swift - the comment claimed a panel hides on deactivate (measured: it does not) --> FIXED (states the mechanism: the away clause defers answering)
- NITs applied: re-look 0.5 s; watchdog raised; stale timing comments and plan lines corrected

#### Iteration 2
**Reviewer model:** sonnet
- [CONVENTION] tools.filepanel-gate.test.js - the comment named the wrong failure branch and count --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] native-app/main.swift - a panel that hides just before AppKit delivers its answer would lose the person's pick --> FIXED (nil only after two consecutive gone looks)
- [WARNING] native-app/main.swift - a panel slower than the first look is answered under the person --> DEFERRED with the measurement: begin shows the panel in about 0.03 s; documented in the doc comment and plan
- NITs applied: openPanelHeld comment corrected (defensive, not load-bearing); plan contradictions fixed; presenter stub reset; branch squashed to one commit style

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] tools/build-kosmos-bundle.sh - only 5 s between the watchdog and the shell alarm --> FIXED (15 s gap restored)
- [WARNING] native-app/main.swift - a real panel reporting not visible while in use --> DUPLICATE of iteration 3's deferral

#### Iteration 5
**Reviewer model:** opus
- [WARNING] native-app/main.swift - the "still in use, leave it alone" branch was untested --> FIXED (two arms: still up past the first look; gone, back, gone again; judged after N looks, not a fixed wait; the re-arm and reset mutations each read "no")
- [WARNING] native-app/main.swift - a given-up real panel stayed on screen, so a second could open beside it --> FIXED (panel.cancel on give-up)
- [WARNING] native-app/main.swift - a zombie panel that still reads visible polls forever --> DEFERRED: logged once after 10 minutes, not answered, because answering under a person still choosing is the defect the two-look rule prevents; named as the weakest premise in the plan
- [CONVENTION] native-app/main.swift - the #2807 comment still said begin always calls its completion --> FIXED
- NIT applied: a test pins the alarm at least 15 s above the watchdog (mutation to 70 s fails it)

#### Iteration 6
**Reviewer model:** sonnet
- no BLOCKER / WARNING / CONVENTION (NITs only)
**Converged.**

### Deferred (for a reader who wants to overturn one)
- A panel slower than 5 s to appear is answered nil (iteration 3): begin measured at about 0.03 s.
- A dropped panel that still reads visible keeps later presses refused until restart (iteration 5): logged after 10 minutes; not answered, to never discard a live pick.

### NITs (non-blocking)
- The doc comment's "within openPanelLookEvery of his coming back" is about 2x that with the two-look rule; indentation of the nested leftAlone call; the gap test's slice runs to end of file (the watchdog phrase is unique today); the fixed 1.5 s waits in the older dropped/hung arms.

### Strengths
- The dropped-callback arm reproduces Josh's abort in-process (exit 134 with his exact exception with the fix removed), and the follow-on arms test his "Change picture dead until restart" state, not just "no crash".
- Every answer still goes through the one call-once `respond`, which also clears openPanelOutstanding.
- Verified on the real board page (create form single and swarm share one input, agent page, profile) with a real NSOpenPanel; switching apps cannot be driven from an agent and is covered by the dropped/hung arms, stated in the plan.
