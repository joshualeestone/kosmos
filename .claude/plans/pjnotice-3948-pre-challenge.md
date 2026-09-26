---
pre_challenge: true
method: challenge-loop
branch: pjnotice-3948
diff_hash: d7381295ffc05d839f8b011c400c83ff605104ae76327095be56bc1de12685c6
subdir_audit: passed
timestamp: 2026-09-26T22:12:44Z
converged: true
---

## Challenge loop: #3948 project notice in the consolidated layout

#### Iteration 1 (blind, opus)
- [MEDIUM] the notice, a body child with no grid row, auto-placed as a full-width strip at the top of the page (and overran the 38 pre-rail rows) --> FIXED: moved inside the Agents rail head.
- [LOW] the browser arm could not see misplacement --> FIXED: enters via applyLayout, measures against #alist.
- [LOW] a layout switch left a stale copy until the next poll --> FIXED: paintRailPjNotice from showTab.

#### Iteration 2 (blind, sonnet)
- [MEDIUM] an always-present 100% flex line added the head's 6px gap with nothing to say --> FIXED: row-gap 0 unfolded; arm asserts the notice adds only its own height (my first form compared to the Projects head, a wrong premise: 28 vs 32px, replaced).

#### Iteration 3 (blind, opus)
- [LOW-MED] loadProjects did not repaint the rail notice --> FIXED.
- [LOW] a wrapping head could push the + to its own line in a 200px rail --> FIXED: .lead flex 1 1 0.
- [LOW] rail success-line clearing untested --> FIXED: unit test, proven red without it.

#### Iteration 4 (blind, sonnet)
- [MEDIUM] the rail focus fallback landed on the unlabelled #alist --> FIXED: the rail's name.

#### Iteration 5 (blind, opus)
- [LOW] the rail name reads "Agents" (not "Project Members") on an empty board or after a failed status read --> ACCEPTED and documented: still a named heading for the rail.

#### Iteration 6 (blind, sonnet)
No issues found. NO NEW FINDINGS.

## Evidence
- Unit: web.project-notice-3923.test.js 15/15; controls red for the rail repaint, success line, and clearing.
- Browser (tools/browser-checks.sh, frozen commits): render-projects + render-consolidated-layouts + render-viewtoggle-header-2154 all pass at 77d5e4abc; controls red with the paint blanked (d258), the notice displaced (fixed position), and the row gap restored (34 vs 28).
- One render-projects retry at b5c3068b0 on the unrelated sticky-header scroll step (load 40); passed on retry.
- Full suite at 7ece2cddb: 2 reds, both mine and fixed in ce8e7d068 (EXPECTED_SITES 177, a hand-built roster row); otherwise timing only at load 70. #1720 and #2518 gates pass (render-project-members-3387 trailer).
- Final browser run at 3badb8300 (render-projects, render-consolidated-layouts, render-project-members-3387): all page checks passed, no retries.
