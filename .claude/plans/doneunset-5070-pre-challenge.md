---
pre_challenge: true
method: challenge-loop
branch: doneunset-5070
diff_hash: 1d7d78caf1b4b3487ead52e969ca3672a555305a2d6438f63bdaae0fe301ef9e
validation: pending. The Mortals run at 3a0a6ff6d FAILED (10-03 17:18) on the #2518 surface gate (5 checks), node suite clean (14938 tests, 0 fail). Gate re-run locally at the new head: still red on the same 5. Queued on Agent1s: render-project-done-4583 two arms (fix / column-gap perturbation), then full browser checks at the final head; per-check surface trailers and a fresh Mortals full run follow.
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-04T13:40:00Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes. Round 4 (sonnet, blind) raised 0 BLOCKER, 0 SHOULD-FIX, 5 NIT (taken or reasoned in the plan).
**Fixed:** every BLOCKER and SHOULD-FIX raised | **Deferred:** NITs not taken are listed with reasons in .claude/plans/doneunset-5070.md

### Per-Iteration Breakdown

#### Round 1 (opus, blind): 0 BLOCKER, 3 SHOULD-FIX, 4 NIT
- [SHOULD-FIX] under-the-name made every done-unset Roadmap row two lines --> FIXED (its own track on the name's line)
- [SHOULD-FIX] caret and rail elbow off-centre on two-line rows --> FIXED with the above
- [SHOULD-FIX] the arm's repaint did not remove injected nodes --> FIXED (removes them, restores the layout)
- Measured 21:56: main 20 passed, 2 FAILED (both new arms); branch 22/22.
#### Round 2 (sonnet, blind): 0 BLOCKER, 2 SHOULD-FIX, 3 NIT, taken
- [SHOULD-FIX] on a phone the tag, count and status pill could squeeze the name to nothing --> FIXED (at 40rem and narrower the tag goes under the name; nowrap)
- [SHOULD-FIX] injected pill lacked the real glyph; nothing asserted the name keeps room --> FIXED (real markup; name >= 60 px at both widths)
- Measured 21:59: main 20 passed, 2 FAILED; branch 22/22.
#### Round 3 (opus, blind): 0 BLOCKER, 1 SHOULD-FIX, 4 NIT
- [SHOULD-FIX] an orphan row's ancestry chip was pulled onto the name's line --> FIXED (pinned to column 1; arm asserts it stays off the line)
- [NIT] run at 1400, 660 and 390 and read the breakpoint from matchMedia --> taken
- Measured 22:05-22:09: main 22 passed, 4 FAILED; branch 29/29; no-pin mutant red at all three widths.
#### Round 4 (sonnet, blind): 0 BLOCKER, 0 SHOULD-FIX, 5 NIT. CONVERGED 22:11
- [NIT] two comments corrected; arm asserts the page's breakpoint agrees 390 is a phone and 660 is not --> taken
- [NIT] 24 px gap with a status but no count --> not taken (the CSS comment already says so)
- Measured 22:12: 29/29.

## [CHALLENGE-LOOP] Rounds 5 to 7 (2026-10-04, after Baron's second review)

Baron's NIT on #5105: the Roadmap row's `column-gap: 12px` made the tag's empty track cost a gap on every row without the tag and on every phone row. Fixed in b4030a102: column-gap 0, 12px as margin-left on the count, the status and the tag (0 on the phone placement), plus a browser-check arm.

#### Iteration 5 (opus, blind): 0 B, 2 W, 3 N
- [WARNING] count-to-status space unmeasured --> FIXED (0818b8027)
- [WARNING] status-only row never measured (it lost the most room, 24/36 px) --> FIXED (0818b8027)
- [NIT] no-tag row's count checked on the tag row's line --> FIXED (0818b8027)
- [NIT] an empty .pjfaces box would still cost 12 px --> NOT A REGRESSION (projectCard emits it only with a count; the old gaps cost the same)
- [NIT] commit message understates the old cost --> noted here

#### Iteration 6 (sonnet, blind): 1 B, 1 W, 1 N
- [BLOCKER] my iteration-5 fix pushed a sixth injected element, so `m.added === 5` failed at every width --> FIXED (340ce602a): count taken before that step. Disclosed: the blocker was introduced by my own fix (I saw it myself while round 6 ran; round 6 confirmed it).
- [WARNING] status-only step depended on the fixture having no pill --> FIXED (340ce602a): a fixture pill is measured as it is
- [NIT] a comment still says "count" --> FIXED with the label (f94398ae8)

#### Iteration 7 (opus, blind): 0 B, 0 W, 2 N. Converged.
- Read the fixture: both rows are created through the sandboxed server with no members, so no count and no status of their own; injected count is 5 in every case; old CSS gives 24 px, double spacing 36/24 px, both red.
- [NIT] the arm's label named only the count --> FIXED (f94398ae8)
- [NIT] a tag-plus-status row (track 3 empty) is not measured --> DEFERRED: other arms catch a spacing regression there; coverage depth only.

All three rounds read only; none ran the check. The run is queued (see validation).
