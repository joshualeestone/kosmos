# tipplace-3920

kosmos#3920: a tip whose target fills the window (the project Conversation column once #2624's taller header lands)
has no place above, below or beside at full width, so the fallback put the card ON the target. Decided: option 1
(a narrower card beside it). When no place fits at full width and the wider side has >= 220px, tipPlace places
once more, narrowed to that room, side-first, keeping the arrow. Rejected option 2 (point at the header row: the
card then sits inside the ringed area, which T35 forbids) and option 3 (inside the area: covers the target's own
controls). T35b proves it with a synthetic window-filling target plus a too-little-room control.
