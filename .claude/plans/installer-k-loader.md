# Plan: installer-k-loader

Josh, 2026-08-26, seeing the installer's static yellow-square badge live
on a screenshot: "Instead of that yellow square with a K, let's put our
animated K that turns into a circle there."

## Change

Ported `startKLoader` (the 155-dot canvas gather-and-scatter K/ring
animation already used on the create-an-agent screen and the update
overlay) into `install/pkg-scripts/installing.html`, verbatim, replacing
the static CSS badge (`<div class="mark">K</div>` with a breathe
keyframe).

Kept byte-for-byte identical to the source's math, including the
`finish()`/`CHECK_LOAD` tick-morph machinery this file never calls --
diffing the two copies now shows the same function, not a silently
diverged partial port.

**One genuine addition, clearly flagged in a comment**: a `stop()`
method the source doesn't have. The source's own comment says a stop
handle would be "deliberate ceremony" because its two mounts always end
in either a page reload or a `finish()` checkmark. installing.html's
"taken" branch is a third kind of ending neither of those covers: no
reload, and `finish()`'s green tick would misrepresent "we found
something and are not sure it's yours" as success. Without a stop, the
mark would keep breathing forever under text that says the search
concluded -- the exact "hung working animation over a settled state"
this file's `settle()` exists everywhere else to prevent.

`settle()` now calls `loader.stop()` instead of adding a CSS `.settled`
class to the mark (the bar keeps its CSS-class approach, unchanged).

## Explicitly not built

`finish()` is ported but never called. Neither of this file's two
endings is the source's "clean finish": the taken branch isn't success,
and the real-ready branch calls `location.replace()` in the same tick
`settle()` runs, so a 900ms tick animation would never be seen before
the page navigates away.

## Verification

- [x] `node --test install.installing-page.test.js`: 8/8 pass (3
      existing tests updated for the canvas architecture, 2 new tests
      added for the loader's presence and the no-finish-call
      invariant).
- [x] `npm test` (full suite): 0 failures.
- [x] Live Playwright verification of both real endings: ordinary wait
      -- sampled the canvas twice, confirmed the frames genuinely
      differ (animating). Taken branch -- sampled twice after settle(),
      confirmed the frames are identical (frozen, not still breathing).
      Screenshots confirm visually: the dot-pattern K mid-gather during
      the wait, and a clean gold ring on settle -- literally "turns
      into a circle."
