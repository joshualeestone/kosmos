# Plan: fix the #1147 image-scroll-bounce re-introduced in the 6.72 batch

## The bug (blocking the 6.72 cut)
render-room-scroll's image arm reds: a reader at the bottom lands ~1152px SHORT of the floor
when new rows carry no-height images = Josh's #1147 ("it bounces me up after I..."),
re-introduced. Passed in 0.6.71 (no #3130), fails in the 6.72 batch.

## The exact break (measured, not assumed)
Instrumented both repin guards and ran the oracle. `pinToBottom`'s per-image re-pin `again()`
bailed on every image:
    DIAG-AGAIN pinnedAt=5261 scrollTop=5645 scrollHeight=7355 match=false   (x4)
So `again()`'s guard `if (el.scrollTop !== pinnedAt) return` treated the reader as "moved" and
did nothing, leaving them 1152px short once the 4 no-height images expanded the room.

Why scrollTop drifted 384px from pinnedAt (NOT the few-px tail-nud layout drift hypothesised):
`holdFloorOnResize`'s ResizeObserver ALSO re-pins the room as each image expands it, advancing
scrollTop legitimately (5261 -> 5645). The two repin mechanisms conflict - the RO's floor-follow
defeats `pinToBottom`'s EXACT-match guard, and neither lands on the final floor. #3130's redesign
(extra reflow from the new .msg-bd/::after markup) is what now triggers the RO mid-load, exposing
the always-fragile exact guard; the re-pin logic itself is unchanged by the batch.

A small tolerance (Math.abs(scrollTop-pinnedAt)<=N) does NOT fix it: the drift is 384px, and a
tolerance that large would swallow a real user scroll-up.

## The fix
`pinToBottom`'s `again()` guard: replace the exact `scrollTop !== pinnedAt` with a TWO-SIGNAL
guard `if (el.__wasOnFloor === false || el.scrollTop < pinnedAt) return`. Neither signal alone is
enough (a first single-signal attempt failed review):
- `__wasOnFloor === false` is the REAL-DOM signal: `holdFloorOnResize`'s scroll listener sets it
  false the moment the person scrolls away from the CURRENT floor, so it catches even a SMALL
  scroll-up made AFTER the ResizeObserver has advanced scrollTop past the (now stale) pinnedAt --
  the dead zone a bare `scrollTop < pinnedAt` would miss and wrongly yank them down (#3066/#1926).
  But it is never updated in the unit stub (which drives scrollTop directly and fires no scroll
  event), so it cannot stand alone.
- `scrollTop < pinnedAt` is the directional check that keeps the unit stub's moved-reader control
  honest (scrollTop 400 < pinnedAt -> bail) where `__wasOnFloor` is undefined.
Together: bail if EITHER says the person left the floor; otherwise re-pin through the RO's downward
follow. `pinnedAt` is KEPT (still referenced by the guard and by the hidden-box header comment).
The hidden-box TOP-drag protection is unchanged - the `!el.clientHeight` early-return still
prevents registering listeners on a hidden box. Durable, not a magic tolerance, and does NOT touch
Josh's #3130 redesign markup.

A first attempt used `__wasOnFloor` alone (removing pinnedAt); it greened the browser-check but
regressed web.room-scroll.test.js's moved-reader control (the stub fires no scroll event), and a
second attempt used `scrollTop < pinnedAt` alone, which left the RO-advanced dead zone open. The
two-signal guard is the reconciliation, and a new test arm pins the dead zone (below).

## Verification
- render-room-scroll (the red-capable browser oracle): was RED (image arm 1152px short), now GREEN
  (gap 0, 20 checks). Untouched, so it stays red-capable (proven red pre-fix).
- web.room-scroll.test.js: 13/13, including the existing moved-reader control + re-pin test AND a
  NEW arm added here, "a reader who scrolled up INSIDE the RO-advanced dead zone is not dragged
  down (#1147)", which pins the dead zone the two-signal guard closes. Proven red-capable: it
  FAILS on a directional-only guard and PASSES on the two-signal guard.
- `pinToBottom` is shared with the agent thread (called from setThread + ~line 25405 + paintRoom);
  the full suite passes (no thread-scroll regression).

## Scope / non-goals
One-line guard change in `pinToBottom`. Does NOT change #3130's markup (Josh's locked redesign) or
the ResizeObserver. Does NOT weaken the oracle.
