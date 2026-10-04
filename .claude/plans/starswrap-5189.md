# starswrap-5189: the stars re-size arm compares the short way round on a wrapping field

Card: kosmos#5189 (found by Renet in #5171's full run; claimed by Baron 19:0x).

## Cause
render-plus-stars-3778's "a re-size keeps each dot in its place" compares each dot's place (a fraction
of the box) before and after with |before - after| < 0.03. The field wraps a dot 4px outside each edge
(web/index.html: `if (q.y > plusSH + 4) q.y = -4`), so a dot drifting across an edge during the ~20
frames reads as a jump of about the whole box though it moved a few px (Renet: 1.0046 -> -0.0013).

## Change (docs/browser-checks/render-plus-stars-3778.js only)
- `wrapDist(a, b, span)`: the short way round on a field of period `span`. The span is the page's own,
  (size + 8) / size, read after the re-size; it is not exactly 1 (the card's `1 - |d|`), because the
  wrap is 4px outside each edge.
- Dot 0 is planted just inside the wrap (y = plusSH + 3.95) at a real dot's top speed (vy = 0.11), in the
  same evaluate as the before-read, on EVERY run, so the wrap is exercised each time rather than by chance.
- Fixture arm: a real crossing (1.005 -> 0.008, span 1.007) is small; the span must be the page's (1.045 ->
  0.005 is small on span 1.05 and 0.04 on span 1); 0.2 -> 0.7 is still a jump.

## Proof (alone, HEADED=0, both window sizes)
- dot 0 crossed every run: y 1.005 before, about 0.007 after
- OLD comparison + planted dot: FAIL at 1400x900 and 900x700
- NEW comparison: PASS 2 runs of 2, both sizes
- injected re-seed (8 new dots after the before-read): FAIL at both sizes, so the check keeps its power

## Review
Round 1 (blind): BLOCKER, the first plant used vy 0.5 (4.5x a real dot), which spent the 0.03 margin by
itself on a slow run (reviewer: FAIL with the grow wait at 700/1100 ms) and would be mislabelled a
re-seed. Fixed: plant at 3.95 / 0.11 in the read's own evaluate. WARNING (stale drift comment) and NITs
(wrong function name plusStarsStep -> plusStarsDraw; fixture could not tell span 1; plant and read split)
all fixed. Re-proven: new PASS 2/2, 1100 ms stress PASS (dot 0 at 0.006), old compare FAIL, re-seed FAIL.

Round 2 (blind): no blockers; the plant now drifts no more than other dots and crosses every run.
NITs taken: the crossing comment (it crosses on the first frame after the plant, not at the re-size);
a negative after-value in the fixture (1.0057 -> -0.0012); and the optional self-check that dot 0
crossed (shown red with a no-cross plant). Converged.
WARNING kept OUT of scope (not this change): ordinary drift of 0.14 px a frame passes 3% of a 544-650 px
box at about 1.5-1.9 s between the reads (reviewer: FAIL on unplanted dots at a 2000 ms wait). Card it if
it ever shows in a cut run.

## Weakest premise
The 4px wrap margin is read from the page source, not from the page at runtime; if it changes, the span
is slightly off (8/size is under 0.01 at these sizes, well inside 0.03).

## Left
Blind review; full validation + browser-checks on the exact head (Mortals, after job-5183); PR; merge.
