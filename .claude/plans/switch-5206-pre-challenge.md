---
pre_challenge: true
method: challenge-loop
branch: switch-5206
diff_hash: 6e43ef303ec7d38f06d581e12667c62739e5839141ef7abcea8c1181fbfe8938
validation: passed (mobile-shots on settings-advanced + tasks, 32 shots: taps<44 0, 0 errors; old audit 2 and 3 false flags. CONTROL: the task page without #5200, all 10 small controls still flagged. Synthetic page with fitOf lifted: an inner box and a strip restored, the old version moved them to 350/435. Tests touching mobile-shots 124/124. The full suite runs on the PR's CI)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T02:30:33Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (fresh blind reviewers, read only; both ran fitOf on synthetic pages and the real tool on live screens)
**Converged:** Yes. Round 2 raised no BLOCKER and no WARNING.
**Fixed:** 1 WARNING, 2 NIT | **Kept, named:** corner probes (rounded hit areas), a label containing an overhanging control

#### Iteration 1 (42bd645b): 0 BLOCKER, 1 WARNING, 3 NIT
- [WARNING] scrollIntoView moved inner scrollers (measured left at 10 and 70) and only the window was restored; a screen's verify or after-step could see a moved page --> FIXED (every scrollable ancestor remembered and restored)
- [NIT] probe geometry undocumented (edge midpoints only; far edges half-open) --> FIXED (documented in the code)
- [NIT] no corner probes --> KEPT (border-radius clips hit-testing; a rounded hit area would false-fail a corner a finger never needs)
- [NIT] a small label containing an overhanging control passes --> KEPT (named; rare, and the overhanging control is itself audited)
- [STRENGTH] no false green found: a button inside a clickable row stays flagged (an ancestor hit fails), a 30x20 label stays flagged, a 43px reach fails, overlays and off-screen points keep the flag; leak guard, overflowOf and the shot all run before fitOf
#### Iteration 2 (3fb010a1): 0 BLOCKER, 0 WARNING, 1 NIT
- [NIT] the ancestor restore honoured scroll-behavior: smooth (a box read 350 just after the audit, 0 a second later) --> FIXED (scrollTo with behavior instant)
- [STRENGTH] remember walks to html, so document.scrollingElement is covered; an overflow:hidden box that scrollIntoView moves is caught (moved to 350, restored to 0); restore order does not matter
