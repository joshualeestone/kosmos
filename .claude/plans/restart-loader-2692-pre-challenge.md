---
pre_challenge: true
method: challenge-loop
branch: restart-loader-2692
diff_hash: 81e5420ef0ddfbb19b6ffbd5ac1a6cbd647fe9df073ada1b186f55cdfb34039c
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T08:33:11Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (converged)
**Converged:** Yes
**Reviewer models:** Sonnet, Opus, Sonnet, Opus (a convergence witnessed by two models, kosmos#2032)
**Total findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 7 NITs
**Fixed:** 3 WARNINGs + 4 NITs (+ 1 self-caused test regression) | **Deferred:** 2 NITs | **Asked:** 0
**Self-generated (SELF):** 0 across all iterations (every finding sat on pre-existing / branch-original lines, never on a loop fix commit's lines)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty; nothing had committed as a loop fix yet)
- [WARNING] docs/browser-checks/render-model-restart-interstitial.js - the detached-canvas negative control false-reds under prefers-reduced-motion: reduce (the reduced-motion branch paints frame(1,0) synchronously before the tick/isConnected machinery). --> FIXED (cb9a075b): emulate reducedMotion no-preference so the control deterministically exercises the animating path (the only path the guard governs); comment scoped accordingly.
- [NIT] browser-check - the Anthropic provider arm omitted noPulsingIcon (asymmetry with the model + OpenAI arms). --> FIXED (cb9a075b).
- [NIT] browser-check - only the model arm asserted loaderPainted (provider arms asserted canvas presence only). --> FIXED in iteration 2 (aa01eba5).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (the header/comment lines cited predate every loop fix commit; blame classifies BRANCH)
**Duplicates of prior findings (confirmed resolved):** the reduced-motion control fix was independently confirmed correct.
- [WARNING] browser-check:16,26 - the JSDoc header still asserted "a ~2s FLOOR" / "a control asserts the prod floor is 2000 in source", contradicting the #2692 note and risking a maintainer "restoring" the source control to = 2000. --> FIXED (aa01eba5): header reconciled to max(2s, K_LOADER_CYCLE_MS) = 4400ms.
- [NIT] web/index.html - stale "~10s" / "breathing-K" / "~2s floor" comments in the two changeDialog test-seam blocks. --> FIXED (aa01eba5).
- [NIT] browser-check - loaderPainted coverage asymmetry (provider arms). --> FIXED (aa01eba5): both provider arms now assert the loader is actually painting.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above (the close() lines cited predate the branch; BRANCH)
- [WARNING] web/index.html - changeDialog's close() sets back.hidden = true (a display:none toggle, not a canvas detach), so the !cv.isConnected guard would not fire if a close path ever ran while the loader is up. Unreachable today (keep hidden, Escape gated on goBtn.disabled), but the cost of the latent gap rose with this change (a leaked JS rAF loop vs. the old free CSS animation). --> FIXED (602098d8): close() now clears the interstitial content (msg.textContent = ''), detaching any loader canvas so the guard fires; robust against a future exit-while-busy rather than dependent on the current teardown path.
- [NIT] browser-check - the negative control uses a never-attached canvas; add an integration proof that the REAL interstitial canvas is detached after the success render. --> FIXED (602098d8): modelCanvasDetachedAfter asserts the live canvas is connected during the hold and disconnected after render.
- Self-caused regression (found by running the suite, not by a reviewer): the close() documentation comment pushed removeEventListener past web.modal-way-out-1316.test.js's fixed 300-char source-slice window, false-reding it. --> FIXED (adb9af18): the test now slices the whole close() body to its closing brace (the robust pattern the onEsc assertion above already uses); comes out stronger, not merely passing.

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Converged** - no new actionable findings. The reviewer independently verified: the K_LOADER_CYCLE_MS scope has no TDZ, the guard is benign for both reload-exit mounts and correct for the interstitial, the close() clear is unreachable-today/harmless-elsewhere, and every browser-check assertion discriminates.
- [NIT] browser-check - the detached-canvas control depends on rAF firing within the 140ms sleep; a frozen-rAF environment would false-pass. --> DEFERRED: the reviewer's own disposition ("no change required") - the model arm's loaderPainted === true in the same run establishes rAF is live, so a dead-rAF environment fails the model checks loudly; the contrast holds.
- [NIT] .claude/plans/restart-loader-2692.md - the "single animation = one full 4400ms cycle" reading of Josh's words is a judgment call. --> DEFERRED: the reviewer confirms it is correctly dispositioned as the plan's weakest premise, left josh-review, and reduces to tuning one constant; not a gap.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | browser-check | BRANCH | detached control false-reds under reduced-motion | FIXED | cb9a075b |
| 2 | 1 | NIT | browser-check | BRANCH | Anthropic arm omits noPulsingIcon | FIXED | cb9a075b |
| 3 | 1 | NIT | browser-check | BRANCH | loaderPainted asymmetry (provider arms) | FIXED | aa01eba5 |
| 4 | 2 | WARNING | browser-check:16,26 | BRANCH | JSDoc header asserts stale 2000 floor | FIXED | aa01eba5 |
| 5 | 2 | NIT | web/index.html | BRANCH | stale ~10s / breathing-K / ~2s comments | FIXED | aa01eba5 |
| 6 | 3 | WARNING | web/index.html close() | BRANCH | close() hides but does not detach; latent rAF leak on future exit-while-busy | FIXED | 602098d8 |
| 7 | 3 | NIT | browser-check | BRANCH | add integration teardown proof | FIXED | 602098d8 |
| 8 | 3 | (regression) | web.modal-way-out-1316.test.js | BRANCH | brittle 300-char source slice broke on the close() comment | FIXED | adb9af18 |
| 9 | 4 | NIT | browser-check | BRANCH | detached control depends on rAF within 140ms | DEFERRED | contrast holds (model arm loaderPainted proves rAF live) |
| 10 | 4 | NIT | plan | BRANCH | "single animation = one full cycle" is a judgment call | DEFERRED | correctly flagged weakest premise, josh-review |

### Outstanding questions (ASKED)
None.

### NITs (non-blocking, across all iterations)
- Deferred: the detached-canvas control's rAF-timing dependency (iteration 4) - mitigated by the same-run loaderPainted contrast.
- Deferred: the one-full-cycle interpretation of Josh's wording (iteration 4) - the plan's stated weakest premise, left josh-review.

### Strengths (across all iterations)
- The lifecycle guard (!cv.isConnected) is placed at the top of tick(), a genuine no-op for the two reload-exit mounts and the real fix for the interstitial; also hardens the re-open path (changeDialog's top-of-function msg.textContent = '').
- K_LOADER_CYCLE_MS is a single source shared by the loader's cycle math and the derived RESTART_HOLD_MS = Math.max(2000, K_LOADER_CYCLE_MS), so the two cannot drift; no TDZ/scope hazard (verified both by inspection and by the browser-check reading the live globals).
- The browser-check assertions genuinely discriminate: an alpha-pixel loaderPainted() check, a detached-canvas negative control, an end-to-end integration proof (modelCanvasDetachedAfter), a noPulsingIcon check, and a source control on the derived floor.
- .kspin remains defined and used for the status-card mark (kGlyph); only the dead .chg-restart .kspin img rule was removed. The status-card render-restarting-2019 check stays 102/102 green.

### Validation note
The 6j final full-suite gate was re-run twice before it passed cleanly: two transient environmental contention reds on this shared, heavily-loaded Mac (first a spawn-timeout in codex-report-bridge.test.js, which passes 9/9 in isolation and is untouched by this branch; then test-cut-guard.sh colliding with another agent's live release cut, PID 25096, since finished). Neither touched this change. The node suite passed 6069/0 throughout, and the branch's own tests (change-dialog x3, render-model-restart-interstitial 20/20, render-restarting-2019 102/102) are green. The final clean run (after the cut finished) recorded validation: passed, subdir_audit: passed on a clean tree.
