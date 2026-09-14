# bc-ci-allowlist-b5-835 - expand the per-PR browser-checks CI allowlist (batch 5)

## Source
#835 (cut-efficiency). Batch 5 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batches 1-4 (#2747, #2753, #2764, #2765). Allowlist is at 22 before this batch.

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; all three added
here are in browser-checks.sh's no-board/no-arg loop, so this is a names-only change.
Self-validating: this PR edits browser-checks.yml (in the job's own path filter), so the
expanded set runs on the runner in THIS PR's CI, and the driver's never-ran guard hard-reds a
misspelled/never-running name. A wrong pick reds this PR before merge.

## Candidate selection - a signal grep, not just a header read
Batch 4 had to DROP render-model-change because a header-only read missed its width-band
boundingBox assertions. So batch 5 was pre-filtered by grepping each candidate for the fragile
signals directly (getBoundingClientRect / boundingBox / screenshot / requestAnimationFrame /
scrollIntoView / .scroll / getComputedStyle), and only candidates with ZERO of them were taken.
All three below have zero fragile signals and zero computed-style reads - they are pure
DOM/text/attribute checks.

## Change
Add three verified pure-DOM-state candidates (0 geometry/style/screenshot/animation signals):
- **render-account-name-2095** - the account name rendering. Pure DOM/text reads (querySelector
  / textContent / hidden), no getBoundingClientRect, no getComputedStyle, no screenshot.
- **render-observed-consumers-1959** - the #1921 observed-liveness badge extended to the other
  /api/accounts-fed consumers; drives the real helper matrix + paint fns against stubbed fetch
  / seeded globals, file://, no server. Pure hidden/text/count state, no geometry/style.
- **render-talk-search** - the talk/search surface. Pure DOM/text/attribute reads, no geometry
  or computed-style.

All three: pure DOM/text/attribute/hidden/disabled state. Mutation-safe: file:// with fetch
stubbed or seeded globals (per the no-board loop); none boots a live board.

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means all
  three run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all three run green headless on the runner. The fragile-signal grep is a strong filter
(zero getBoundingClientRect/getComputedStyle/screenshot/animation in any of the three), but it
is a lexical signal, not a proof - a check could in principle assert a timing-sensitive state
some other way. This PR's own CI is the definitive backstop: a wrong pick reds this PR before
merge and I drop that name, so a miss costs an iteration, never a bad merge.
