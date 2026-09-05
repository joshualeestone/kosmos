---
pre_challenge: true
method: challenge-loop
branch: fix-2187-connect-box
diff_hash: 23d7d9723c931b93b6067355d1e8edf6586cd285dfcca518cb1c54675e9a8a66
validation: passed
subdir_audit: passed
timestamp: 2026-09-05T06:35:19Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (6.0 baseline + 3 blind review passes)
**Converged:** Yes (iteration 4 found zero new actionable findings)
**Total findings:** 6 (1 BLOCKER, 1 WARNING, 1 CONVENTION, 3 NITs)
**Fixed:** 4 | **Deferred:** 3 (1 CONVENTION + 2 NITs) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 initial validation)
Clean baseline. The full suite reported one failure (`test-cut-guard.sh`, "cut guard: 1 failures") under contention — the 0.6.31 release cut had just wound down (live board on :16180, load 3.27), and the run's own machine note flagged it ("a red that is green alone is contention"). Reran `test-cut-guard.sh` alone: 0 failures. My diff touches nothing near the cut guard. Not a defect.

#### Iteration 2 (blind review 1)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
- [CONVENTION] .claude/plans/ — No plan file for this branch --> DEFERRED (single-CSS-rule night-shift build; documented on card #2187 + commit + check docblock; a plan file for one rule is ceremony)
- [NIT] render-firstrun-connect-box-2187.js:52-58 — isGold comment's tolerance rationale was inaccurate (getComputedStyle returns the DECLARED rgba uncomposited, exact) --> FIXED (commit 7bc19c53)
- [NIT] render-firstrun-connect-box-2187.js:11-16 — header overclaimed that the check exercises the pack's forced-light ground (it only runs light) --> FIXED (commit 7bc19c53)
- [NIT] web/index.html:5824 — gold literal could drift from its .fr-confirm sibling --> DEFERRED (by design, matches the sibling and cross-referenced in the CSS comment; the file's own no-token-in-#firstrun discipline)

#### Iteration 3 (blind review 2)
**New findings:** 1 BLOCKER, 1 WARNING, 1 NIT (+ 1 duplicate CONVENTION)
- [BLOCKER] render-firstrun-connect-box-2187.js:43 — the check navigated http://127.0.0.1:4399 but the browser-checks.sh `for n in` loop runs each member with no URL and boots no server; siblings there self-boot or load file://. As wired it would have hit a refused connection and gone RED; it only passed standalone against a hand-started board --> FIXED (commit cc2b1247): converted to load web/index.html over file:// (drives only client-side painters, reads computed style, needs no /api), matching render-firstrun-model-continue-2134. Verified 10/10 hermetically (chromium+webkit, HEADED=0, no server) and re-proven RED (8/10 box arms) against the pre-fix page over file://.
- [WARNING] browser-checks.sh:1128 + README.md:150 — the wiring comment and README row described the self-booting shape the check did not have --> FIXED (commit cc2b1247): corrected both to state the hermetic file:// mechanism.
- [NIT] web/index.html:5823 — styling #fr-sub boxes every connect phase, incl. the `stuck`/error attention row --> DEFERRED (intentional and consistent: the gold wash IS the pack's attention treatment, the stuck row keeps its own red mark for severity, documented in the CSS comment; carving out one phase would couple the CSS to JS phase names for marginal gain)
- [CONVENTION] .claude/plans/ — no plan file (re-raise) --> DEDUP of iteration 2's deferred entry

#### Iteration 4 (blind review 3)
**New findings:** 0. Converged — no new actionable findings; 5 STRENGTHs confirming the fix, the hermetic wiring, the non-vacuous check, and clean conventions.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 2 | CONVENTION | .claude/plans/ | No plan file for this branch | DEFERRED | Single-CSS-rule night-shift build; documented on card + commit + check docblock |
| 2 | 2 | NIT | render-firstrun-connect-box-2187.js:52 | isGold tolerance rationale inaccurate | FIXED | 7bc19c53 |
| 3 | 2 | NIT | render-firstrun-connect-box-2187.js:11 | header overclaimed forced-light coverage | FIXED | 7bc19c53 |
| 4 | 2 | NIT | web/index.html:5824 | gold literal could drift from .fr-confirm | DEFERRED | By design; matches sibling, cross-referenced in comment |
| 5 | 3 | BLOCKER | render-firstrun-connect-box-2187.js:43 | check expected an external board the loop never starts | FIXED | cc2b1247 (file:// hermetic) |
| 6 | 3 | WARNING | browser-checks.sh:1128 / README.md:150 | wiring prose described a shape the check did not have | FIXED | cc2b1247 |
| 7 | 3 | NIT | web/index.html:5823 | box wraps every connect phase incl. error state | DEFERRED | Intentional, consistent, documented |

### NITs (non-blocking, across all iterations)
- [NIT] Gold literal drift risk vs .fr-confirm (iter 2) — deferred, matches sibling by design
- [NIT] Box wraps every connect phase incl. `stuck` (iter 3) — deferred, intentional/consistent

### Strengths (across all iterations)
- CSS is minimal and correct: `#firstrun #fr-sub:not(:empty)` / `:empty` are mutually exclusive by selector (no cascade conflict), reuse the exact .fr-confirm gold tokens, specificity is unambiguous (iters 1-3)
- No regressions to adjacent elements: #fr-sub-msg (error line) is a separate sibling and untouched; action buttons live in the sticky footer, not #fr-sub (iters 1-3)
- The browser check is rigorous and non-vacuous: checkrow real-size asserted before any style arm; the empty control is a genuine discriminator; isGold pins the hue ordering; drives the page's own painters (iters 1-3)
- Genuinely hermetic after the iteration-3 fix: loads file://, boots no server, correctly placed in the no-URL loop; runs both chromium and webkit (iter 3)
- Conventions clean: no em dashes; theme reasoning accurate (#firstrun forces --k-surface:#ffffff, gold is theme-independent rgba) (iter 3)
