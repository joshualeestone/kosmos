---
pre_challenge: true
method: challenge-loop
branch: createnav-2190-rt
diff_hash: 8d479f30932ae5a5c9021971fe044a92c7ba6ac9c7745a9464ad67cc2aa12961
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T15:15:53Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (6.0 baseline as iteration 1; two blind review passes as iterations 2-3)
**Converged:** Yes -- iteration 3 returned zero NEW findings.
**Total findings:** 5 (0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT, + 3 baseline wiring failures) + strengths
**Fixed:** 4 | **Deferred:** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline validation)
Full `node --test` on the rebased branch surfaced 3 failures, all from the ADOPTED WIP's
INCOMPLETE browser-check wiring (indexed in the README but never wired/reconciled):
- `#1387` wired guard: render-createnav-2190.js not in browser-checks.sh run loop -> WIRED it into
  the no-boot file:// loop.
- `#1864` reason-grep: the check adds 1 finding-emit site (42->43) and 1 catch site (24->25) ->
  bumped EXPECTED_SITES + EXPECTED_CATCH_SITES with annotations.
- reason-grep quotable: the check printed findings on `  - ` lines the CI gate cannot quote ->
  changed to the accepted `  FAIL  ` + finding shape (a red now names the actual problem).
All FIXED + committed; baseline re-ran 4592/4592.

#### Iteration 2 (first blind review pass)
**New findings:** 0 BLOCKERs, 1 WARNING, 1 NIT.
- [WARNING] render-createnav-2190.js -- the check pinned screen-nav state but NOT the K-loader
  (MADE_MARK) lifecycle, the most regression-prone part (a prior round caught a RAF left running on
  a hidden canvas). FIXED: the check now captures MADE_MARK during-post (non-null: loader started on
  click) and at the final screen (null after route-back: dropMyLoader ran). Perturbation-proven --
  neutering dropMyLoader's `MADE_MARK = null` makes the refused arm fail with "the K-loader was NOT
  dropped on route-back".
- [NIT] web/index.html watchForAgent walk-away -- a success-path walk-away leaves the loader
  breathing. DEFERRED: pre-existing (the old success path did the same), partly intentional (the
  timeout/partial "breathing" design), and NOT introduced by #2190's nav change -- out of scope. A
  candidate follow-up card, not this card's work.

#### Iteration 3 (second blind review pass)
**New findings:** 0. **Converged.** The reviewer independently verified the loader lifecycle is sound
on every #2190 path (traced no `await` between the watch guard and the success finish, so the
current attempt's mark is always the one finished), the hermetic check is non-vacuous +
perturbation-sound + asserts the loader lifecycle, the wiring is fully correct (all 4 guards pass),
and no em dashes; it also confirmed the deferred NIT is genuinely pre-existing/out-of-scope.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | wired | tools/browser-checks.sh | check not in run loop | FIXED | wired into no-boot loop |
| 2 | 1 | reason-grep | browser-checks-reason-grep.test.js | emit/catch counts stale | FIXED | 42->43, 24->25 |
| 3 | 1 | reason-grep | render-createnav-2190.js | findings not gate-quotable | FIXED | `  FAIL  ` shape |
| 4 | 2 | WARNING | render-createnav-2190.js | loader lifecycle unasserted | FIXED | MADE_MARK assertions, perturbation-proven |
| 5 | 2 | NIT | web/index.html (watchForAgent) | walk-away loader breathing | DEFERRED | pre-existing + intentional + out of scope |

### Strengths (across all iterations)
- finish-before-start fixes a genuine latent RAF leak; finish() is idempotent and terminates its own
  RAF (iteration 2/3).
- dropMyLoader keyed on MADE_MARK===myMark is correct on every route-back + walk-away, never stops a
  newer attempt's loader (iteration 2/3).
- the hermetic check drives the REAL handler, captures the during-post discriminator synchronously,
  and asserts the loader lifecycle; perturbation-sound (iteration 2/3).
- wiring complete + correct: no-boot loop, indexed, reason-grep counts, quotable FAIL lines,
  selectors present (iteration 3).

### Provenance
Adopted from Angel's paused `createnav-2190` WIP (built + iteration-1-reviewed on a ~10-behind
checkout), rebased onto current green main as `createnav-2190-rt`. The 2 reds she flagged were
resolved by Baron's 6.35 step-3b (render-create-form was a stale-checkout artifact; render-accounts-
openai was Kitty's separate stale check, fixed in #2235) -- neither is #2190's nav change, confirmed
by the nav-only diff scope. No render-check blocker.

## Rebased for a merge conflict (2026-09-05, after convergence)
main advanced (#1926 render-talk-anchor-1926 merged, touching the same hot wiring files), so the
branch was rebased onto origin/main. The only conflicts were mechanical wiring-count reconciliation:
the no-boot browser-checks.sh loop now carries BOTH render-createnav-2190 and render-talk-anchor-1926,
and the reason-grep counts were reconciled to the combined totals (EXPECTED_SITES 43->44,
EXPECTED_CATCH_SITES 25->26). No code-logic change, so the challenge-loop convergence still holds;
full suite re-run 4592/4592 green and the hermetic check re-verified (EXIT 0). diff_hash updated to
the rebased diff.
