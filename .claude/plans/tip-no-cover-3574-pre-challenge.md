---
pre_challenge: true
method: challenge-loop
branch: tip-no-cover-3574
diff_hash: cda72581101434cf91c52e779a367c3fc9f1dcc7948f09e599fb9f8b15bc14e7
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T02:52:18Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: no BLOCKER, one WARNING declined with reasons below, one NIT)
**Context:** the 0.6.93 staging cut went red; #3574's Settings tip covered Check for Update. Splinter held
the re-cut for this fix until 23:00 CDT.

### Per-Iteration Breakdown

#### Iteration 1 - opus: 2 BLOCKERs, 4 WARNINGs, 2 NITs --> FIXED c7d088a7
- [BLOCKER] the clear-place search could land the card on its own target or the tour's ring --> target kept clear
- [BLOCKER] a card's last place carried over between tips and tour steps --> kept place keyed per tip/step, cleared on close
- far target keeps a stale place --> only while near; tour penalised for dimmed controls --> tour avoids only its ring;
  centred card leaves a stale covers value --> set; T31 could pass on the wrong screen --> titles asserted (T2 arm added)
#### Iteration 2 - sonnet: 2 WARNINGs --> FIXED 37f953e3
- left-side placement lost its arrow and aliased the fallback --> .tipcard.right; grid cost per scroll --> early-exit test
#### Iteration 3 - opus: 2 WARNINGs --> FIXED 00dd675c
- agent tiles (div[data-agent]) not counted as controls, and T31 read back tipPlace's own report --> selector widened,
  T31 measures coverage itself; two Settings section names did not exist and were skipped --> real sections, asserted
#### Iteration 4 - sonnet: 1 WARNING DECLINED, 1 NIT. **Converged.**
- large focusable panes (terminal viewport, usage history) count as controls, so a screen dominated by one has no clear
  place. DECLINED for the release: the fallback is the pointing place covering least, tried in main's own order (below,
  then above), so the worst case is main's behaviour, never worse; those panes only show with a live captured window.
  Follow-up: treat page-sized regions as not-controls.

### Evidence
- render-update-toast (the check that failed the cut) passes on this branch without its test-side change, and fails
  on origin/main with the cut's own error (tipcard-title intercepts pointer events).
- render-help-tips-3574 95/95. Run with this branch's check against origin/main's code: T31 fails (the Settings tip
  covers upd-btn and auto-toggle), and T14 fails.
- Full validation passed on 00dd675c (clean tree).
