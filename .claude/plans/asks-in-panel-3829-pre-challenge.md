---
pre_challenge: true
method: challenge-loop
branch: asks-in-panel-3829
diff_hash: 9aba0f465bc13052728c4d75a1006e3166c8f0ac757a4ca65df91fe3785840f9
subdir_audit: passed
timestamp: 2026-09-26T01:24:38Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one blind reviewer on c10c072fc, then the fixes measured with the real browser checks and a perturbation).
**Converged:** Yes.

## Iteration 1 (blind review of c10c072fc)
- [BLOCKER] `#plus-asks` was gated only on "on the Plus page", so in the not-enrolled and sign-in states the cards showed with no panel below them, and the sign-in state's centred column would re-flow. Fixed: the in-panel slot is used only while `#plus-flow` is visible; otherwise the full cards stay in the top card.
- [WARNING] `#plus-asks` had no live region, so a request arriving while the person is on the Plus page was silent to a screen reader. Fixed: `role="status" aria-live="polite"`, the same as `#askcard`.
- [WARNING] Nothing tested the placement. Fixed: render-waiting-phone-718 now asserts the notice's Review button, the in-panel Allow and Deny, and the no-panel fallback.
- [NIT] `askAct('open')` repaints twice (showTab already repaints). Harmless; kept, because it makes the handler correct on its own.
- [NIT] Two delegated click listeners whose visibility is complementary. Kept; merging them would couple two surfaces for one line.

## Iteration 2 (measured)
- [WARNING] The new 718 arms called `page.evaluate` where the function's page is `phone`, so they had never run (the runner freezes HEAD, and the earlier run read the pre-edit file). Fixed and run.
- [STRENGTH] Perturbation: with the flow gate removed, the `[allow/place]` arm goes red (`{"panel":false,"card":true,"allow":0,"slot":1}`); restored, green.
- [CONVENTION] Surface gate: render-plus-stars-3778, render-plus-signin-3478 and render-plus-gate-1615 ran green on this branch; per-check trailers carry that.

## Measured
- render-waiting-phone-718 and render-plus-panel-3829: PASS (runner, frozen at 6a664ef51).
- render-plus-stars-3778, render-plus-signin-3478, render-plus-gate-1615: PASS.
- web.allow-card, web.plus-tab, web.plus-wizard-3796: 20/20.

## Disclosed
- The `.plus-asks button { min-height: 44px }` rule under `hover: none` did NOT go red when removed at 375px, because `#panel-settings .dsec button` already gives 44px below 40rem. It is kept for touch screens wider than that (a tablet), which this check does not exercise.

## Weakest premise
- That a live request cannot usefully appear on the Plus page while it is not connected. If it can, it now shows in the top card as before the addendum, which is the old, known layout rather than a broken one.
