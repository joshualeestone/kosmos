---
pre_challenge: true
method: challenge-loop
branch: plus-wizard-3796
diff_hash: fe59952af7597af5e712ccec863c6303042eab7d1c65f9c5209334c7f863387e
subdir_audit: passed
timestamp: 2026-09-25T20:38:57Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 blind review pass (sonnet), plus my own renders of every wizard step at 1400x950 and 900x760, before (origin/main) and after.
**Converged:** Yes. 2 blockers and 1 should, all fixed and perturbed red. 1 nit, covered by an existing check.

## Iteration 1 (sonnet)
- [BLOCKER] The engine could undo Sign out: a verify (or second, enrol, or confirm-enrol) still awaiting the tunnel program when signin-cancel landed wrote its answer back afterwards, which resurrected a spendable session. Fixed with a cancel epoch, checked after every await. The engine test runs a verify, cancels mid-flight, then checks that register and second are refused. Red without the epoch check.
- [BLOCKER] On the page, a request answering after Sign out could move the NEXT sign-in to a step, and a resend cooldown kept writing into its status line. Fixed with a client epoch: stale answers return untouched, and Sign out and re-entry stop the cooldown and re-enable every control. The browser arms (a late verify, a running cooldown) are each red without their half.
- [SHOULD] Nothing tested the secondary button's stroke (Josh's addendum). Taken: a browser arm checks it; a transparent border turns it red.
- [NIT] The dark-field override relies on source order at equal specificity. Not changed: render-plus-blue-1615 now reads the painted colour of both field kinds, so a reorder turns it red.
- Verified by the reviewer: every ask on the card and in both addenda is met; the new route gets the same board-token and remoteWriteGuard gating as its sibling signin-* routes; no em dash in any of five spellings.

## Found in flight (mine)
- Two old page-test harnesses broke on my first version: they have no window, and their fake elements have no tagName. Fixed the guard and the busy test; both harnesses pass.
- The browser-check surface gate caught a genuinely stale arm: render-plus-blue-1615 probed the FIRST Kosmos+ field for the white-field red, and that field is now dark. It now reads each kind of field's own colour; dropping the wizard's coral turns it red.

## Measured
- Full suite on 2193a02b7: 9529 tests, 0 failed, exit 0. After merging main, the Kosmos+ unit tests, both guard tests (the reason-grep counter and the selector check) and the render-plus-signin-3478, render-plus-blue-1615, render-plus-stars-3778 and render-plus-gate-1615 checks are all green.
- Centring measured: 271px above and 271px below at 1400x950. On main the card sits at the top.
- Shots: ~/.cache/claude-handoffs/shots-3796/{before-steps,after}.

## Weakest premise
- The centring measures the room from the section's top to the window's bottom, less 32px. A layout that scrolls the settings pane inside another scroller would centre against the window rather than that scroller; today the page scroll is the window's.
