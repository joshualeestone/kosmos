# bc-ci-allowlist-b9-835 - expand the per-PR browser-checks CI allowlist (batch 9)

## Source
#835 (cut-efficiency). Batch 9 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1-8 (#2747-#2779). Allowlist at 35 before this batch.

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; all three added
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
Add three verified DOM-state candidates (0 geometry/paint signals; timing waits noted):
- **render-model-restart-interstitial** - the model-restart interstitial state. file://; reads
  DOM/text state; 1 timing wait. (Its only fragile-grep hit was the word "screenshot" in a
  comment referencing a Josh screenshot - not a screenshot API call.)
- **render-firstrun-openai-sub-2621** - the first-run OpenAI subscription connect box. file://,
  fetch stubbed; reads DOM/text state; 3 timing settles.
- **render-worlds-switcher-1704** - the worlds switcher. BOOTS its own sandboxed temp-rooted
  server (spawn node server.js, mkdtemp AGENT_WORKFORCE_* roots, fake-tmux); reads DOM/text
  state; 2 timing settles.

None asserts geometry/computed-color/screenshot/animation/scroll. The timing waits (1/3/2) are
plain settles, not paint/animation waits - not a headless-robustness concern, just a few
seconds of CI time. Mutation-safe: model-restart + openai-sub are file:// with fetch stubbed;
worlds-switcher boots a sandboxed temp-rooted server (roots frozen before require, fake-tmux) -
none touches the operator's real board/data.

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means all
  three run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all three run green headless on the runner. The refined grep (geometry + timing) + the
mechanism check are strong filters but not proofs; this PR's own CI is the definitive backstop -
a wrong pick reds this PR before merge and I drop that name, so a miss costs an iteration, never
a bad merge. The timing-wait checks (all three have some) have marginally more flake surface on
a starved runner, but a flake reds this PR before merge rather than causing a bad merge.
