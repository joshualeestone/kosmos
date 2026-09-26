# main-ci-4021: a main suite run is never cancelled by the next merge

Card: kosmos#4021 (part 2; part 1 is answered on the card with a measurement).

## Problem
test.yml's concurrency group cancels in-progress runs on every ref. The suite takes ~14m and on
2026-09-26 merges landed faster, so every main run 17:57Z-18:49Z was cancelled and main's red
showed first at the 0.6.99 cut's step 3.

## Change
- `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`: PR runs are still cancelled when
  superseded (#3499); a main run always finishes. GitHub keeps at most one pending run per group,
  so the head of main is always next and the queue cannot grow.
- The same for android.yml and ios.yml, which also build on a push to main and carried the same
  shape (review iteration 1; #3499 keeps the three in lockstep).
- ci.main-runs-finish-4021.test.js pins all three: evaluates the expression for main and a PR ref,
  with a control that the old `true` reads as cancelling main, and a control that every workflow
  with a push-to-main trigger is in its list (a new one cannot slip in unpinned).

## Iteration 1 (sonnet)
- WARNING: android.yml and ios.yml had the same main-cancelling shape --> fixed.
- NIT: the control compared against the live text, so it misfired when the live file regressed
  --> built from the line's shape instead.
- Confirmed: the expression is GitHub's documented form; a newer pending run replaces an older
  pending one regardless of cancel-in-progress; release.sh step 3 runs `yarn test` itself and reads
  no Actions status, so the cut's gating is unchanged (this is about SEEING a red main sooner).

## Rejected
- One run per main sha (group keyed on github.sha): tests every merge but stacks N suites on the
  shared macOS runners, the #3499 contention.
- A scheduled uncancellable full run: slower to see a red than this, and a second place to maintain.

## Weakest premise
A red commit superseded while PENDING never runs on its own; the red still shows at the head,
but bisecting may need a manual dispatch.
