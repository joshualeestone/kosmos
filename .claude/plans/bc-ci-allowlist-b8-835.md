# bc-ci-allowlist-b8-835 - expand the per-PR browser-checks CI allowlist (batch 8)

## Source
#835 (cut-efficiency). Batch 8 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1-7 (#2747-#2776). Allowlist at 32 before this batch. Resumed per
Splinter's directive (the earlier disk hold was withdrawn: the fleet disk is two big static
repos, not these small Node config edits, and Kosmos builds are not threatened).

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; all three added
here are in browser-checks.sh's no-board/no-arg loop, so this is a names-only change.
Self-validating: this PR edits browser-checks.yml (in the job's own path filter), so the
expanded set runs on the runner in THIS PR's CI, and the driver's never-ran guard hard-reds a
misspelled/never-running name. A wrong pick reds this PR before merge.

## Candidate selection - fragile-signal grep + mechanism check
Each candidate was grepped for fragile signals (getBoundingClientRect / boundingBox /
screenshot / requestAnimationFrame / scrollIntoView / .scroll / getComputedStyle) - 0 hits;
confirmed in the no-board/no-arg loop; and mechanism-checked (all three are file:// with
window.fetch stubbed / seeded globals, 0 spawn-server, 0 waitForTimeout - the cleanest kind).

## Change
Add three verified pure-DOM-state world-management checks (0 fragile signals, file://, 0 waits):
- **render-world-import-2563** - world import flow. file://, fetch stubbed. Pure DOM/text state.
- **render-worldsw-abandon-2628** - world-switch abandon behaviour. file://, fetch stubbed. Pure
  DOM/text state.
- **render-worldswitch-2238** - world switcher. file://, fetch stubbed. Pure DOM/text state.

All three assert only DOM/text/attribute/hidden state (no getBoundingClientRect,
getComputedStyle, screenshot, animation, or scroll) and are hermetic (file:// with window.fetch
stubbed or seeded globals, no server). None touches a live board.

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means all
  three run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all three run green headless on the runner. The fragile-signal grep + mechanism check are
strong lexical filters but not proofs; this PR's own CI is the definitive backstop - a wrong
pick reds this PR before merge and I drop that name, so a miss costs an iteration, never a bad
merge.
