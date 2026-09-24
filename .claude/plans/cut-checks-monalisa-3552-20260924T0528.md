# cut-checks-monalisa-3552: fix two 0.6.91 cut-time browser checks (#3552)

## Context
0.6.91's staging cut is blocked (#3552) by five cut-time-only browser checks red on origin/main.
Splinter routed two of them to me (both staled by my own merged work):

## Fix 1: render-talk-fill-2622 (from #3547/#3500 agent-nav redesign)
Symptom (narrow width): `A2c` failed with `snavHeight=268 > boxHeight=209`. The arm asserted
`snavHeight < boxHeight`. That predated the #3500 boxed-nav redesign: the agent nav is now a vertical
stack of icon+label boxes (the DM box, the four-pack, the AI Settings/model pill, Advanced), so at
narrow width it is legitimately TALLER than the talk box. Measured: `snavHeight` (rendered) == 268 ==
`snavScrollH` (content), `flex: 0 1 auto`, `alignSelf: auto`, so the nav is content-height, NOT
stretched by the collapsed single-column grid. The arm's real concern is exactly that stretch, so the
assertion now pins it directly: `snavHeight === snavScrollH` (content-height, not ballooned), which
holds no matter how tall the content is and still catches a genuine grid-stretch.

## Fix 2: contrast (remove control unreachable, from #3500)
Symptom: `contrast` failed with `remove: could not be reached  page.click: Timeout` on the Remove
control. #3500 folded Remove into Advanced (the `d-sec-remove` section reveals under the `term`
pill's group), so there is no `data-go="remove"` pill any more and clicking it timed out. This is the
same shape as #2916 (memory folds under model, skills under instr, both revealed with the parent so
their contrast is measured on that surface). So Remove reveals under the `term` (Advanced) surface;
drop the separate `remove` surface. The whole-page SCAN measures the Remove controls on the `term`
surface.

## Verification
- render-talk-fill-2622.js: A2c PASS (`snavHeight=268 == snavScrollH=268`), all Talk-box fill checks pass.
- contrast.js: served against a fully-sandboxed board (all AGENT_WORKFORCE_* + fake tmux, per
  boot_board), both themes PASS, the `term` surface finds 24 texts and all clear AA. No "remove could
  not be reached".

## Scope
Browser-check assertion/coverage updates only (docs/browser-checks/render-talk-fill-2622.js,
docs/browser-checks/contrast.js). No product-code change. Release blocker, ahead of #3495.
