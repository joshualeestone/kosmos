# bc-ci-allowlist-b6-835 - expand the per-PR browser-checks CI allowlist (batch 6)

## Source
#835 (cut-efficiency). Batch 6 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1-5 (#2747, #2753, #2764, #2765, #2768). Allowlist is at 25 before this.

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; all four added
here are in browser-checks.sh's no-board/no-arg loop, so this is a names-only change.
Self-validating: this PR edits browser-checks.yml (in the job's own path filter), so the
expanded set runs on the runner in THIS PR's CI, and the driver's never-ran guard hard-reds a
misspelled/never-running name. A wrong pick reds this PR before merge.

## Candidate selection - fragile-signal grep
Each candidate was grepped for fragile signals (getBoundingClientRect / boundingBox /
screenshot / requestAnimationFrame / scrollIntoView / .scroll / getComputedStyle); only
candidates with ZERO were taken, and only those confirmed present in the no-board/no-arg loop
(render-adopt-1531 also had zero signals but is NOT in the no-board loop, so it was dropped -
it would report "never ran"). All four below have zero fragile signals and are in the loop.

## Change
Add four verified pure-DOM-state candidates (0 geometry/style/screenshot/animation signals):
- **render-account-badge-1921** - the observed-liveness account badge (a known no-board stub
  harness for account-row rendering). Pure DOM/text/hidden state.
- **render-import-add-inplace-2419** - guards that the import-add-in-place row is SUPPRESSED on
  first run (the original add-in-place behaviour was superseded by #2497; the check now asserts
  the suppression). BOOTS its own sandboxed temp-rooted server (spawn node server.js with all
  AGENT_WORKFORCE_* roots = fresh mkdtemp, fake-tmux) - not file://. Reads DOM/text/row state.
- **render-open-terminal-0644** - the View-Agent open-terminal control. file://; pure DOM/text
  state.
- **render-firstrun-scan-on-grant-1652** - guards that the scan/import rows are SUPPRESSED on
  first run (post-#2497 behaviour; the check asserts a would-be poll does NOT fire). BOOTS its
  own sandboxed temp-rooted server (spawn node server.js, mkdtemp roots, fake-tmux) - not
  file://. Reads DOM/text/row state.

All four assert only DOM/text/attribute/hidden/disabled/row state (no getBoundingClientRect,
getComputedStyle, screenshot, animation, or scroll). Mutation-safe: account-badge-1921 and
open-terminal-0644 are file:// (fetch stubbed / seeded globals); import-add-inplace-2419 and
firstrun-scan-on-grant-1652 BOOT their own sandboxed servers (spawn node server.js with every
AGENT_WORKFORCE_{DATA,WORKERS,LAUNCH,PROJECTS} root set to a fresh fs.mkdtempSync dir before the
child starts, and AGENT_WORKFORCE_TMUX_BIN = test-support/fake-tmux.sh) - an established pattern
in this same no-board loop (e.g. render-detail-header-1841, render-worlds-switcher-1704). None
touches the operator's real board or data. (Two of the four also use a fixed waitForTimeout -
600ms / 2500ms - as a settle, which adds a few seconds to per-PR CI time; not a headless-
robustness concern, just noted.)

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means all
  four run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all four run green headless on the runner. The fragile-signal grep is a strong lexical
filter but not a proof; this PR's own CI is the definitive backstop - a wrong pick reds this PR
before merge and I drop that name, so a miss costs an iteration, never a bad merge.
