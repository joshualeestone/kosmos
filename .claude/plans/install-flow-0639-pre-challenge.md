---
pre_challenge: true
method: challenge-loop
branch: install-flow-0639
diff_hash: 8b635a58fd7abdd4f7169a8435e4bdb53adf551a437c2781f7440f23d7b6ef28
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T16:41:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

> post-merge re-sync (2026-09-06): current main merged in (picks up #2340 + Renet's connect-confirm fix #2344); auto-merged web/index.html clean (no conflicts), re-verified full suite 4898/0 + the four browser-check gates 18/0 + syntax on the merged tree. diff_hash recomputed for the merged diff; the 4 fixes are byte-unchanged from convergence.

**Iterations:** 2 blind passes (plus the initial + final validation gates)
**Converged:** Yes (iteration 2 returned zero findings after iteration 1's were fixed)
**Total findings:** 2 CONVENTIONs, 1 NIT (all in iteration 1; iteration 2 clean)
**Fixed:** 3 | **Deferred:** 0

The four 0.6.39 install-flow fixes (#9/#10/#11/#12) from Josh's fresh-install test. The
highest-risk change (#12 removing the whole success-screen reveal subsystem) was verified across
two independent blind passes: every removed symbol survives only in comments, no dangling runtime
call remains, kept "shared" symbols are genuinely still used, and the step 7->8 progression holds.

### Per-Iteration Breakdown

#### Iteration 1
**New:** 2 CONVENTIONs, 1 NIT
- [CONVENTION] web.firstrun-consent-prc2.test.js:8 -- em dash in an added comment --> FIXED
- [CONVENTION] .claude/plans/install-flow-0639.md:1 -- em dash in the plan title --> FIXED
- [NIT] web/index.html .s7-app.s7-k -- gold glow (for the old gold-K placeholder) left a gold halo behind the real app icon --> FIXED (neutral drop shadow; Mona approved keeping Josh's verbatim macOS copy)

#### Iteration 2
**New:** 0 findings --> CONVERGED. Independently re-verified: no surviving runtime call to any
removed symbol (grep of all 14 across web/index.html), kept shared symbols still used
(frCheckRow, /api/machine+appLocation, /api/reveal-app, /api/ping-setting's Create-screen control),
step 7->8 intact, CSS scoping clean, tests non-vacuous, accessibility sound, no em dashes.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | web.firstrun-consent-prc2.test.js:8 | em dash in comment | FIXED | commit (iter-1 fixes) |
| 2 | 1 | CONVENTION | .claude/plans/install-flow-0639.md:1 | em dash in title | FIXED | commit (iter-1 fixes) |
| 3 | 1 | NIT | web/index.html s7-app.s7-k | gold halo behind real icon | FIXED | neutral drop shadow |

### Strengths (across both iterations)
- #12 reveal subsystem removed cleanly across all layers in lockstep (markup, CSS, JS painter/state,
  the firstRunBoot call, and the browser/unit fixtures); no dangling call can crash the wizard.
- #11 removed the second consent switch + its wiring while leaving /api/ping-setting and the
  Create-an-Agent control intact (the feature survives; only the duplicate control is gone).
- The success icon reuses the pre-existing img.fc-k asset byte-for-byte (not a second copy).
- Tests were rewritten to pin the new behavior (absence-form assertions the #758 selectors gate
  reads correctly), not to pass vacuously.
- No em dashes; accessibility sound (decorative dock aria-hidden, real icon alt="").

### Note
Branch base predates #2340, so its own suite is green. Merging current main in for the PR will pick
up #2340 (+ Renet's connect-confirm test-fix once it lands) and may need a web/index.html conflict
resolution; the proof will be regenerated after that final main-sync.
