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
- Dot 0 is planted crossing the bottom edge (y = plusSH + 3.5, vy = 0.5) on EVERY run, so the wrap is
  exercised each time rather than by chance.
- Fixture arm: wrapDist(0.999, 0.001) is small; wrapDist(0.2, 0.7) is still a jump.

## Proof (alone, HEADED=0, both window sizes)
- dot 0 crossed every run: y 1.005 before, about 0.007 after
- OLD comparison + planted dot: FAIL at 1400x900 and 900x700
- NEW comparison: PASS 2 runs of 2, both sizes
- injected re-seed (8 new dots after the before-read): FAIL at both sizes, so the check keeps its power

## Weakest premise
The 4px wrap margin is read from the page source, not from the page at runtime; if it changes, the span
is slightly off (8/size is under 0.01 at these sizes, well inside 0.03).

## Left
Blind review; full validation + browser-checks on the exact head (Mortals, after job-5183); PR; merge.
