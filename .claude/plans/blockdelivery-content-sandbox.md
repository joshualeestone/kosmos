# Plan: sandbox the block-delivery harness's content-side data root (#2259 / #2648 cut blocker)

## Problem

The 0.6.55 release cut aborted at step 3 on mortals (the headless-signing cut box). Not a red
main: `tools/test-block-delivery.sh` gives 0 failures on a fresh origin/main checkout on a dev
laptop (Agent1s), but reds on mortals. Diagnosed to the STALE arm:

- `tools/check-block-delivery.js` decides whether each managed block "has anything to deliver".
  For `you`/`policy`/`doctrine` it reads REAL engine state (`engine/you.js`'s `read().state`,
  etc.) via `engine/store.js`'s data root, which is `AGENT_WORKFORCE_HOME || os.homedir()`.
- The harness sandboxes the AGENT dir (`KOSMOS_WORKERS_DIR` -> `$T`) but NOT that content-side
  data root. Its arms assume the content state is EMPTY (no you record, no policies, no doctrine).
- That held on a dev laptop but not on mortals, whose provisioned roster (#2600) saves a real
  `you.json`. So the fixture `you` block read as "delivered to all entitled" instead of STALE ->
  1 failure -> step 3 red -> the cut aborts on EVERY mortals cut. The env-dependence entered via
  #2259 (the runner-aware change).

## Fix

Sandbox the content-side data root too: `export AGENT_WORKFORCE_HOME="$T/home"` (empty) in the
harness, so `engine/store.js`'s data root points at a dir with no `.../Kosmos/you.json` and the
content side is absent BY CONSTRUCTION on any box, matching what the arms already assume.

## Correctness (Splinter's requirement: prove the STALE case still reds under the fixture)

A fix that greened against real you-state would let a genuinely-stale block ship. Added a CONTROL
arm: write a REAL you record (via `you.js.save`) into a separate sandbox home, then assert the
SAME fixture `you` block reads DELIVERED, not STALE. This proves the sandbox did not blanket-green
the detection - it still tells a deliverable block from a stale one. A setup guard fails loudly if
the record could not be saved, so a broken control can never masquerade as a passing detection.

## Verification

- Agent1s (you.json absent): 0 failures, STALE arm passes, control discriminates.
- mortals (real you.json present, the box that failed): 0 failures, STALE arm passes, control
  discriminates. Run via a temp worktree of this branch against mortals' real engine state.

## Scope

One file: `tools/test-block-delivery.sh` (harness only; no product/engine change). This
permanently unblocks every future mortals cut. Owner: Baron (release harness gates the cut);
engine/you.js internals were not needed (harness-level fix). Route to Angel only if you.js
internals surface.
