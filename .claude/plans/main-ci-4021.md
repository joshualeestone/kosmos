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
- ci.main-runs-finish-4021.test.js pins it: evaluates the expression for main and a PR ref, with a
  control that the old `true` reads as cancelling main.

## Rejected
- One run per main sha (group keyed on github.sha): tests every merge but stacks N suites on the
  shared macOS runners, the #3499 contention.
- A scheduled uncancellable full run: slower to see a red than this, and a second place to maintain.

## Weakest premise
A red commit superseded while PENDING never runs on its own; the red still shows at the head,
but bisecting may need a manual dispatch.
