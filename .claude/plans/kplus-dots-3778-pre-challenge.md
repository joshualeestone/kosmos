---
pre_challenge: true
method: challenge-loop
branch: kplus-dots-3778
diff_hash: 4205a154fcf995c106c1b4833f556b66451aeeae62ba6a73452775f8c21f78b3
subdir_audit: passed
timestamp: 2026-09-25T20:10:41Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind review passes (pass 2: opus), plus the check run at 1400x900 and 900x700 at deviceScaleFactor 2.
**Converged:** Yes. Pass 2 found 0 blockers; its 3 SHOULDs and 1 NIT were all taken.

## Iteration 1
- [SHOULD] Re-sizing the buffer cleared the canvas, and the next draw waited a frame, so every re-size painted one blank frame. Taken: plusStarsStart draws one frame at once, and an arm checks for it.

## Iteration 2 (opus)
- [SHOULD] The no-blank-frame arm passed even when nothing re-sized, because a buffer that never changed still holds its last frame. Taken: the arm now also requires the buffer height to have changed.
- [SHOULD] The window-resize arm at 1400 did not move the box (1400 to 1220 leaves the canvas at 544x666), so it tested nothing. Taken: the resize is now to 60% of the width, and the arm requires the box to move.
- [SHOULD] Every change in the section's height re-seeded the field, so every dot jumped. Taken: plusStarsResize keeps each dot in its place in proportion to the box, and the count follows the area. The window resize uses it too. A new arm checks that dots keep their places.
- [NIT] "Leaving disconnects" passed on a null alone. Taken: it now counts real disconnect() calls made by the leave. Excluding the check's own observer fixed a hole I had first added myself.
- Verified by the reviewer:
  - no resize loop, since the canvas is absolute inset:0 and its buffer cannot move the box;
  - the observer is disconnected on teardown and there is no leak across leave and enter;
  - the zero-size and devicePixelRatio cases are safe;
  - the #3780 copy matches the card word for word;
  - no em dash in any of five spellings.

## Measured
- Perturbations, each red on exactly its arms:
  - re-seed on re-size: the keep-places arm, at both sizes;
  - a teardown that only nulls the watcher: the leave arm;
  - no watcher at all: the watcher, settled, grown, no-blank-frame and leave arms.
- #3780 grep for "not open yet": 3 hits (engine/remote.js:111, server.js:6848, and the new comment at web/index.html). All are comments about the old #790 bug. None is user-facing.
- Full suite on 2f6a55c8c: 1 red, the #758 page-id guard reading the check's own spacer ids. Fixed in 39890b8e4 (data marker), and the guard now passes. The shots are in ~/.cache/claude-handoffs/shots-3778/{before,after}.

## Weakest premise
- The keep-places arm allows 3% drift for eight dots over about 20 frames. A re-seed that happened to land all eight within 3% of their old places would pass, which is vanishingly unlikely.
