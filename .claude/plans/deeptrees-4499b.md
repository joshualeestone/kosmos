# deeptrees-4499b: deep org charts draw smaller (kosmos#4499, the size half)

Finished looks like: on the deep 100-agent trees the card measures (randomTree(seed, 100, 0.05), seeds 1..200,
natural px of the page's own orgPlaceGated), the median and the worst are under main's 2725 and 5003, no tree is
bigger than on main, and nothing gets worse: 0 crossings, 0 overlaps, no line closer to an unrelated face than the
lesser of 12px and main's own, and no line down leaving a manager closer to its line up than the lesser of 38 degrees
and main's own, on any tree, over the card's sweep too. The 12px half shipped in #6195 (10-15).

## Measured on main first (11-22, origin/main)
Median 2725, worst 5003 (1.725x the pre-#4434 1580); 63 of 200 trees at 2x or more. Identical to the 10-14 baseline.

## Built (web/index.html, orgPlace)
Raiden's 09-29 prototype idea, rebuilt on today's orgPlace and measured at each step:
- Below the first ring, a team first tries a WIDE window: ORG_WIDE (0.95) of 90 degrees either side of its manager,
  within its slice, instead of the tangent cap acos(r_manager / r) * 0.9, which far from the hub leaves almost no angle.
- The wide placement is kept only if an exact test passes: no new line properly crosses any line already drawn, none
  comes within ORG_STEP of the hub, and the usual spacing and 12px clearance (strict apart()) hold, at a radius inside
  the one the capped placement chose. Otherwise the capped placement stands, as before.
- A team the capped placement puts on two rings (#4472) keeps them.
- lineOf's radius band starts at the line's true closest approach to the hub, since a wide line can dip.
- orgPlace(nodes, floored, capped): `capped` turns the wide try off; with it, orgPlace is exactly main's (reviews r1 and
  r2 compared it with origin/main's orgPlace on their own sets, 10,080 and 9,600 layouts, all equal).
- orgPlaceGated (review r1): the wide window is greedy, so alone it drew a few charts bigger than main (a 19-agent tree
  9.4%; 5 of 5,040 random trees over 1%). A chart with a manager below the first ring is now laid out main's way and
  wide, and the wide one is drawn only when it is no bigger and its first ring is no less clear. That makes "never
  bigger than main" hold by construction, not by sample. The winner is remembered per tree shape (who reports to whom,
  in order), so a repaint of an unchanged fleet lays it out once.
- The 12px floor on the wide layout is also funded when it is no bigger than main's chart (randomTree(58, 100, 0.1):
  without it 11.76px against main's 18px).

## Measured result, final (seeds 1..200 deep; the card's sweep: n in {12,30,60,100} x first-ring share
{0.05,0.1,0.33} x seeds 1..60, leads of 2..120, and randomTree(23, 250, 0.06): 840 trees)
- Deep: median 2497.5 (1.581x of 1580, main 1.725x), worst 4963 (main 5003); 40 trees at 2x or more (main 63).
- Per tree against main, all 1040: 0 bigger; 58 deep and 90 sweep trees more than 10% smaller.
- 0 crossings, 0 overlaps (under 46px). Least line-to-face: deep 12.97 (= main), sweep 11.07 (= main); no tree's below
  min(12, its main value). Least manager angle: deep 38.01 (main 38.12), sweep 29.33 (= main); no tree's below
  min(38, its main value).
- Speed (1000 agents, measured before the angle rule, load ~4): a repaint of an unchanged fleet 19-37ms, main 18-39ms;
  a change of shape (two layouts, once) 30-68ms. The angle rule adds one O(n) pass per layout.

## Decided
- Plain leaf-count shares. Leaf count to the power 0.85 (the prototype's) took the deep median to 2284 but grew 27 of 200
  trees by over 1% (worst 1.22x); every ruling on this card asks for no regression on any measured tree.
- Keep #4472's two rings. Wide, a CEO over 3 x 14 fanned two teams nearly 180 degrees on one ring, curling below the hub:
  a different look from a deliberate design, for no measured size gain (the deep numbers are identical either way).
- Not "near 1580": the card's own prototype put the floor at about 1900 to 2000 with no crossings, 62px spacing and
  12px clearance, but it did not measure folded lines. With the angle floor this lands at 2497.5. What is left is held
  by the room reservation (ORG_BRANCH_ROOM), the strict 12px check and the 38-degree angle, all kept: going further means
  drawing something less readable than main. The card should say so when it closes.

## Weakest premise
That the measures I hold cover readability. Round 3 found a misreading (a line folding back along its manager's line)
that crossings, overlaps and line-to-face distance all passed; I added the angle at a manager, but other misreadings
with no measure here could exist. On crossings themselves, review r1 gave an argument (a line's angle from the hub
changes monotonically, no wide line turns past 85.5 degrees, every team sits ORG_STEP outside its manager) that the
exact test sees every line that can cross; 0 crossings in all sweeps agrees.

## Review r1 (opus): no blocker; fixed
- WARNING greedy window bigger than main on a few charts -> the main-vs-wide pick above, and a test (NEVER BIGGER THAN
  MAIN) with r1's 19-agent tree and three random trees, red against the previous commit (control run).
- WARNING the gate's second rule compared with main's proportional layout, not what main draws -> it now compares with
  main's drawn chart (bar = main.maxR), and the pick above backs it.
- CONVENTION comments and the NON-BUG test claimed the proportional layout equals main -> reworded; the test accepts
  either unfloored layout exactly.
- NIT the wide crossing loop now runs after the cheaper spacing and room checks.

## Tests
- web.org-lanes-4472.test.js: the deep-tree test measures orgPlaceGated over its own 60 seeds (2425.5 and 4805; main
  2699.5 and 4805): median <= 2500, largest <= 4810. A change that loses the window, or always draws main's, fails.
- web.org-first-ring-clear-4499.test.js: rt(58,100,0.1) added to the funded charts (red without the gate's bar);
  NEVER BIGGER THAN MAIN (red before the main-vs-wide pick); MEMO (red with a hit path drawing main's); NO FOLDED LINE
  (red before the angle rule: 2.3 degrees at rt(142,100,0.05)); TURN FLOOR PINNED; HONEST's baseline is main's chart.
- All org-chart node tests pass. Browser: render-org-sectors-4434 15/15, render-org-lanes-4472 17/17,
  render-org-first-ring-6196 11/11, on sandboxed boards.
