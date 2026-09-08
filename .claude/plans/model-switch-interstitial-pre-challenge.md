---
pre_challenge: true
method: challenge-loop
branch: model-switch-interstitial
diff_hash: 899b6ec2a9dccad81093a343ea7b380824e9c6596eb29d414906d21acdf4f089
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T01:23:37Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 produced zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 3 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, several NITs
**Fixed:** all actionable | **Deferred:** 1 NIT (provider-switch consistency, out of scope) | **Asked:** 0

Every round caught a real issue on a safety-critical shared modal -- the loop working as designed.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] web.change-dialog.test.js -- lifts changeModelNow into a VM whose ctx lacked `providerOf` (which the change now calls) AND pinned the old success sentence -> the suite reddened (ReferenceError swallowed into a wrong say()). FIXED (a316860a): added providerOf to the ctx + updated the expected reduced sentence.
- [WARNING] run the model browser-checks -> render-model-change.js + render-memory-controls.js both PASS on this branch (dry-run returns 'partial', so the hold never engages).

#### Iteration 2
- [BLOCKER] the new check was not wired into tools/browser-checks.sh -> wired-test red AND the check never ran. FIXED (3d534cf2): added to the hermetic loop.
- [BLOCKER] the new check adds two reason-grep emit sites -> EXPECTED_SITES 72->73, EXPECTED_CATCH_SITES 44->45. FIXED (3d534cf2).
- [WARNING] a held render could paint into a closed/reopened modal. FIXED (3d534cf2): `if (back.hidden) return` guard (chosen over a module-level token, which would re-break the change-dialog VM tests -- the same sweep class).
- (A third claimed BLOCKER on render-model-change was a FALSE POSITIVE: dry-run returns 'partial', not 'changed', so the interstitial hold never engages -- verified EXIT 0.)

#### Iteration 3
- [CONVENTION] the changeDialog comment said "other three callers" but there are FOUR (provider switch omitted). FIXED (12dad0e5): corrected in web/index.html + plan.
- [NIT] em dashes in the plan file. FIXED (house style).
- Verified: ran every meta-test (reason-grep, wired, indexed, selectors, change-dialog, exit-1313, every-test-runs, fixture-discipline, no-brand-refs) -- all green.

#### Iteration 4
- [CONVENTION] the browser-check HEADER also miscounted the callers (one file missed in iter 3). FIXED (0a79fe23): corrected to four.
- [NIT] the busyHtml comment said "(kGlyph + a fixed string)" but the markup is hand-inlined -> reworded. FIXED.
- [NIT] the 44px K sourced the 32px asset -> switched to kosmos-48.png. FIXED.
- Full verification green.

#### Iteration 5
**Converged** -- zero BLOCKER/WARNING/CONVENTION. Full verification green (21 meta-test passes, check 9/9, render-model-change PASS).
- [NIT] the plan still referenced kosmos-32.png (stale after the iter-4 swap). FIXED.

### Final Ledger (blocking findings)

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web.change-dialog.test.js | providerOf missing from VM ctx + old sentence | FIXED | a316860a |
| 2 | 2 | BLOCKER | tools/browser-checks.sh | new check not wired | FIXED | 3d534cf2 |
| 3 | 2 | BLOCKER | browser-checks-reason-grep.test.js | emit-site counts not bumped | FIXED | 3d534cf2 |
| 4 | 2 | WARNING | web/index.html | held render could clobber a reopened modal | FIXED | 3d534cf2 |
| 5 | 3 | CONVENTION | web/index.html | "three callers" should be four | FIXED | 12dad0e5 |
| 6 | 4 | CONVENTION | render-model-restart-interstitial.js | header "three callers" should be four | FIXED | 0a79fe23 |

### Strengths (across iterations)
- The #1313 no-trap invariant is carefully preserved under the new deferred render (`spoke` synchronous, hold success-only + bounded, every path reaches `say`, `back.hidden` guard).
- The opt-in `busyHtml`/`minBusyMs` leave the other four callers byte-unchanged; the browser-check drives the real functions with a matched CONTROL + a source-pinned prod-hold control.
- The test seam is prod-inert and injection-safe throughout.
