---
method: challenge-loop
branch: cut-checks-monalisa-3552
timestamp: 2026-09-24T11:11:50Z
diff_hash: 8f2ffb7959030d0ad49e50737cd10decc9d0dbb500714891bc188f688bfced3b
---

# Pre-challenge proof: `cut-checks-monalisa-3552` (kosmos#3552)

**Method detail:** blind adversarial challenge loop, 3 iterations, a fresh blind reviewer
each round with the reviewer model rotated (sonnet / opus / sonnet, per kosmos#2032), converged.

The change fixes two of the five cut-time browser checks blocking the 0.6.91 staging cut,
both staled by my own earlier merged work (#3500's agent-nav redesign). It is browser-check
assertion/coverage code only, no product change. Every finding below was re-derived by me
before I acted on it; where the reviewer was right I said so, and I record the two rewrites
that review rejected before the third survived. Both checks were re-verified green on the
rebased tree (this diff): render-talk-fill A2c `navGapInDleft=0` with a real negative control,
contrast `all green` served against a fully-sandboxed board including the `term` surface.

#### Iteration 1 (sonnet)

**Returned: 1 BLOCKER, 1 CONVENTION.**

**[BLOCKER] The first A2c rewrite was vacuous.** My initial fix replaced the stale
`snavHeight < boxHeight` arm with `snavHeight === snavScrollH` (asserting the nav is
content-height, not grid-stretched). The reviewer showed this can never fail: `#d-nav` and the
snav carry no overflow of their own, so `scrollHeight` simply echoes the rendered box height
for these elements. `snavHeight === snavScrollH` is therefore true by construction regardless of
any stretch, i.e. it certifies nothing. This is the a-guard-from-the-same-mental-model blind
spot: the guard, written from the same picture as the bug, inherited the bug's blind spot.

**[CONVENTION] No negative control on the real regression.** A new =0 assertion must be paired
with a positive control that fails on the actual defect (prove-a-new-check-can-fail). The
rewrite had none, and could not have had a meaningful one, because it was vacuous.

#### Iteration 2 (opus)

**Returned: 1 BLOCKER, 1 WARNING.**

**[BLOCKER] The second A2c rewrite was a false negative.** I changed the arm to a gap measured
on `#d-nav` itself. The reviewer showed `#d-nav` is a flex column and always ends flush with its
own content, so a gap-on-`#d-nav` reads ~0 whether or not the regression is present. The real
regression (a collapsed `.dbody` grid) stretches the nav's `.dleft` ROW, not `#d-nav`. So the
assertion had to be keyed to the `.dleft` row, not the element that can never show the stretch.
Fixed to `navGapInDleft` = signed gap between the snav's bottom and its `.dleft`'s bottom (minus
`.dleft`'s padding-bottom): ~0 flush, positive if the row is stretched, negative if the row
shrinks and the nav overflows. Negative control (removing the `.dbody`
`grid-template-rows: auto minmax(0,1fr)` fix at ~index.html:2569) drives `navGapInDleft` to
−128 and turns A2c red — a wide margin over the ±4 tolerance. Measured, both arms.

**[WARNING] contrast section-count comment drifted.** The `contrast` fix dropped the now-folded
`remove` surface (Remove reveals under `term`/Advanced since #3500, the #2916 fold pattern) but
the "Six surfaces" comment still claimed six. Corrected to five, with the fold history spelled
out so the count is checkable against the SURFACES array.

#### Iteration 3 (sonnet)

**Returned: 1 NIT, no actionable findings.**

**[NIT] Comment precision.** The A2c comment said the gap subtracts ".dleft's padding" where the
code subtracts `padding-bottom` specifically. Tightened to `padding-bottom`. Committed as the
iteration-3 fix; no code-behaviour change.

Zero actionable findings after dedup: **converged.**

## Verification

- render-talk-fill-2622.js: A2c PASS on the rebased tree (`navGapInDleft=0`, `snavHeight=268`,
  `boxHeight=209`); all sibling arms (A1–A9) green; negative control on the real regression → −128,
  A2c red. web/index.html is byte-identical between the pre-rebase base and current origin/main, so
  the −128 control measured earlier against that same file still holds.
- contrast.js: served against a fully-sandboxed board (all `AGENT_WORKFORCE_*` + a fake tmux, via
  the canonical `tools/browser-checks.sh` boot_board, pinned Playwright, `HEADED=0`), both themes,
  `all green`; the `term` surface finds 24 texts all clearing AA and there is no
  "remove: could not be reached".
- Full 6j validation PASSED on the rebased basis (hash 8f2ffb795903), no genuine reds.

## Scope

Browser-check assertion/coverage updates only (`docs/browser-checks/render-talk-fill-2622.js`,
`docs/browser-checks/contrast.js`) plus the working plan file. No product-code change. Release
blocker for the 0.6.91 cut (#3552).
