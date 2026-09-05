---
pre_challenge: true
method: challenge-loop
branch: engmode-leak-2131
diff_hash: 4f8647d3f528a930cec0c42f39f889aa5dbfaa659c3a6a8dd314d96d06140d29
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T04:45:58Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind reviews (the branch was rebased onto a newer origin/main for a
tools/browser-checks.sh check-list union before the loop; the 6.0 baseline was clean once
a machine-load contention flake in test-cut-load-guard cleared on a re-run).
**Converged:** Yes - iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION.
**Total findings:** 1 WARNING, 3 NITs; plus many STRENGTHs.
**Fixed:** 4 | **Deferred:** 0 | **Asked:** 0

### What this change is
kosmos#2131 (v0.6.28): the agent terminal showed on the Projects/conversation screens with
Engineering (Advanced) mode OFF. Investigated on CURRENT main: the leak does NOT reproduce -
a controlled browser probe showed eng-mode OFF hides the terminal and eng-mode ON shows it
(the gating works, hardened by #370/#965/#2047 since). So rather than a speculative fix
against fixed code, this ships a REGRESSION GUARD: docs/browser-checks/render-engmode-gate-2131.js,
wired into tools/browser-checks.sh + indexed in the README. No web/index.html change.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 WARNING, 1 NIT.
- [WARNING] render-engmode-gate-2131.js - the DETAIL #d-window arm had no ON control (vacuous)
  and the docstring over-claimed "each hidden-in-Off arm is paired with an ON arm". --> FIXED:
  removed the #d-window arm (it needs a live captured pane screen the fleet harness cannot
  provide, so it is hidden regardless of eng-mode - a hidden-in-Off assertion on it would pass
  whether or not the gate worked). The gate is page-wide (ENG_ON); the project arms with a real
  ON control prove the mechanism the detail view shares, and the safety arm is a real detail-view
  assertion. Docstring + README corrected; floor 9 -> 8.
- [NIT] cleanup leaked on the acquisition error path (fleet.install/srv.start/chromium.launch
  before the try). --> FIXED: moved them inside the try; finally guards browser/server.

#### Iteration 2 - converged
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION. 2 NITs:
- [NIT] the population-floor process.exit(1) sat inside the try, skipping the finally cleanup on
  a gutted run. --> FIXED: moved the floor AFTER the finally.
- [NIT] the plan prose said "9 checks"; the check has 8 chk() arms (floor already 8). --> FIXED.

### Final Ledger

| # | Iter | Category | File | Description | Status |
|---|------|----------|------|-------------|--------|
| 1 | 1 | WARNING | render-engmode-gate-2131.js | vacuous #d-window arm + over-claiming docstring | FIXED |
| 2 | 1 | NIT | render-engmode-gate-2131.js | cleanup leaks on acquisition throw | FIXED |
| 3 | 2 | NIT | render-engmode-gate-2131.js | floor exit inside try skips finally | FIXED |
| 4 | 2 | NIT | engmode-leak-2131.md | plan said 9 checks, it is 8 | FIXED |

### Outstanding questions (ASKED)
None.

### Strengths
- Non-vacuity is real: the ON control genuinely toggles eng-mode ON and asserts the SAME
  .pj-viewport / #pj-thread become VISIBLE that the OFF arms assert hidden (verified against
  pjApplyEngMode: vp.hidden = !ENG_ON). A gate regression reds the OFF arm; an absent element
  also reds (=== 'hidden' / 'VISIBLE').
- The SAFETY arm targets a genuinely-exempt element: #d-qask visibility is driven by
  !body.asking, with no ENG_ON term, so gating it would flip the arm red - pinning the exemption.
- Docstring + README describe only the arms that exist; the removed #d-window is referenced solely
  to explain its omission. Harness hygiene correct (acquisition in try, guarded finally, roots
  swept, clean SKIP when playwright absent). Wired once + indexed once. No em dashes.
- The "already-fixed, ship a regression guard" judgment matches the fleet's stale-card discipline.
