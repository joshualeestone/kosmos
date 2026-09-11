# bc-ci-allowlist-b9-835 - expand the per-PR browser-checks CI allowlist (batch 9)

## Source
#835 (cut-efficiency). Batch 9 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1-8 (#2747-#2779). Allowlist at 35 before this batch.

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; the one added
here is in browser-checks.sh's no-board/no-arg loop, so this is a names-only change.
Self-validating: this PR edits browser-checks.yml (in the job's own path filter), so the
expanded set runs on the runner in THIS PR's CI, and the driver's never-ran guard hard-reds a
misspelled/never-running name. A wrong pick reds this PR before merge.

## Candidate selection - refined fragile-signal grep + mechanism check
The fragile-signal grep now also flags timing pollers (setTimeout/waitFor), per the batch-8
NIT. Each candidate was grepped for geometry/paint signals (getBoundingClientRect / boundingBox
/ screenshot / getComputedStyle / requestAnimationFrame / scrollIntoView / .scroll) - 0 REAL
hits (a lone "screenshot" in a render-model-restart-interstitial code comment was confirmed a
false positive, not an API call) - confirmed in the no-board/no-arg loop, and mechanism-checked
(file:// vs sandboxed server) with the timing-wait count recorded.

## Change
Add ONE verified DOM-state candidate (0 geometry/paint signals):
- **render-worlds-switcher-1704** - the worlds switcher. Boots server.js IN-PROCESS
  (require('../../server.js') + srv.start(0) on an OS-chosen port) against mkdtemp
  AGENT_WORKFORCE_* roots frozen before the require, with AGENT_WORKFORCE_TMUX_BIN=/bin/echo;
  reads DOM/text/visibility state. Its waits are the ROBUST kind: 10 event-driven condition
  waits (4 waitForSelector + 6 waitForFunction), plus only 2 fixed waitForTimeout settles -
  so it does not depend on a fixed sleep landing inside a race window.

It asserts no geometry/computed-color/screenshot/animation/scroll. Mutation-safe: runs
server.js in-process against throwaway mkdtemp roots + fake tmux, on a random port - it never
touches the operator's real board/data.

## Excluded this batch (caught in blind review, dropped)
- **render-firstrun-openai-sub-2621** - DROPPED (iteration 3). It is headless-robust and
  mutation-safe (file://, fetch stubbed, no geometry/canvas), but it settles an async
  subscription poll with FIXED sleeps ONLY - waitForTimeout(2100) to cover a 1200ms poll +
  paint, plus 300/1600ms in the abandon arms - and has ZERO event-driven condition waits.
  On a starved CI runner a poll tick can slip past the 2100ms window and red intermittently.
  That is not a bad-merge risk (a flake reds the PR, never merges), but adding a fixed-sleep-
  only check to the ALWAYS-RUN per-PR subset degrades exactly the reliability #835 exists to
  keep - so it is excluded rather than merged. (A future version that converts its sleeps to
  event-driven waits, like worlds-switcher, would be a clean re-add.)
- **render-model-restart-interstitial** - DROPPED. It reads LIVE CANVAS PIXEL DATA
  (getContext('2d').getImageData) in loaderPainted()/detachedPainted to verify a rAF-driven
  canvas animation (startKLoader) actually painted, and uses
  emulateMedia({reducedMotion:'no-preference'}) to force the animating path - functionally an
  animation/paint assertion, the fragile class the allowlist excludes. It also has 12 sleep()
  call sites with tight margins. My fragile-signal grep missed both: the rAF loop lives in
  web/index.html (not the check file), the check reads it via getImageData (not in my signal
  list), and its timing uses a custom sleep() helper (my grep matched waitForTimeout/setTimeout/
  waitFor, not sleep). METHOD REFINEMENT for future batches: extend the grep to getImageData /
  getContext (canvas pixel reads) and a custom sleep( helper, and note that a rAF loop in the
  PAGE can be asserted by a check that reads the canvas without any rAF token in the check file
  itself - so a check that emulateMedia(reducedMotion) + reads a canvas is an animation check
  even with a 0 literal-token count.

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means it
  runs and passes headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That render-worlds-switcher-1704 runs green headless on the runner. The refined grep (geometry + timing) + the
mechanism check are strong filters but not proofs; this PR's own CI is the definitive backstop -
a wrong pick reds this PR before merge and I drop that name, so a miss costs an iteration, never
a bad merge. Its event-driven condition waits make it robust to runner load (the flaky fixed-sleep
candidate, openai-sub, was excluded above); and this PR's own CI is the backstop regardless.
