---
pre_challenge: true
method: challenge-loop
branch: doneunset-5070
diff_hash: 07dc5d05a193c5edcd8b89bd0a8bafc7a6958b19ba3d938e24294cbb223e06ac
validation: pending (CI full suite gates the merge; the merge watcher merges only when every check passed). Mortals full run ick-5070 has been queued since about 19:00 behind about 14 runs and stays queued. Focused: browser check render-project-done-4583 29/29 on the branch, main fails the new arms (22:12).
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-03T05:13:25Z
iterations: 4
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
