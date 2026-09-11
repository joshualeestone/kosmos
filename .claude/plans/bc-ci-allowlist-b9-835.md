# bc-ci-allowlist-b9-835 - expand the per-PR browser-checks CI allowlist (batch 9)

## Source
#835 (cut-efficiency). Batch 9 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1-8 (#2747-#2779). Allowlist at 35 before this batch.

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; both added
here are in browser-checks.sh's no-board/no-arg loop, so this is a names-only change.
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
Add two verified DOM-state candidates (0 geometry/paint signals; timing waits noted):
- **render-firstrun-openai-sub-2621** - the first-run OpenAI subscription connect box. file://,
  fetch stubbed; reads DOM/text state; 3 timing settles (plain sleeps, not paint waits).
- **render-worlds-switcher-1704** - the worlds switcher. Boots server.js IN-PROCESS
  (require('../../server.js') + srv.start(0) on an OS-chosen port) against mkdtemp
  AGENT_WORKFORCE_* roots frozen before the require, with AGENT_WORKFORCE_TMUX_BIN=/bin/echo;
  reads DOM/text state; 2 timing settles.

Neither asserts geometry/computed-color/screenshot/animation/scroll. The timing settles (3/2)
are plain sleeps, not paint/animation waits - not a headless-robustness concern, just a few
seconds of CI time. Mutation-safe: openai-sub is file:// with fetch stubbed; worlds-switcher
runs server.js in-process against throwaway mkdtemp roots + fake tmux, on a random port - neither
touches the operator's real board/data.

## Excluded this batch (caught in blind review, dropped)
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
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means both
  run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That both run green headless on the runner. The refined grep (geometry + timing) + the
mechanism check are strong filters but not proofs; this PR's own CI is the definitive backstop -
a wrong pick reds this PR before merge and I drop that name, so a miss costs an iteration, never
a bad merge. The timing-wait checks (both have some) have marginally more flake surface on
a starved runner, but a flake reds this PR before merge rather than causing a bad merge.
