# orgsector-4434: org chart branches in their own sectors, so connector lines never cross

Card: kosmos#4434 (Josh, #admin 2026-09-28 17:14 CDT; assigned by Liu Kang). On first load, a manager's
reports were placed outside that manager's angular sector, so their lines crossed another manager's.

## Finished means
On first load, and after any agent is added, removed or re-parented, every report sits inside its manager's
sector and no connector line crosses another. Pinned by:
- a geometry test (a proper-segment-intersection count over realistic trees with uneven branch sizes, plus
  seeded random trees), checked on `orgPlace`'s positions AND after the physics settles, red on main;
- a browser check with a screenshot of a seeded uneven org.
Same input gives the same positions (stable across reloads); the existing no-overlap spacing is kept.

## Cause (read on main 41e887303)
`orgPlace` (web/index.html) spread the first ring evenly by index, then fanned each manager's reports over a
FIXED 69 degree arc (`Math.PI / 2.6`) centred on the manager, whatever room that manager had. Neighbouring
fans overlap when a manager has several reports, so lines cross. The physics (`orgStep`) then repels and
springs nodes with no notion of whose branch they are in, so it can also carry a node across.

## Design
- A fleet with no managers keeps the old layout exactly (hub lines are radial and cannot cross; the
  first screen most people see does not change).
- Otherwise, a radial tree layout by sectors:
  - each first-ring agent gets a slice of the circle sized by its leaf count, and sits at the slice's
    centre; a crowded first ring still spills to a second lane (hub lines are radial, so lanes are safe);
  - a manager's reports share a window centred on the manager: the manager's slice, capped at the tangent
    angle acos(r_manager / r_report) so every line runs steadily outward (the Eades condition). Each report
    gets a sub-slice by its leaf count and sits at its centre. A lone report sits straight out, a pair is
    centred on its manager (the existing #352 tests);
  - each ring's radius grows from its base until no two nodes on it are closer than ORG_MIN_ARC.
  - Why this cannot cross: every edge lies within its parent's slice angularly, sibling slices are
    disjoint, and the tangent cap keeps each edge's distance from the hub monotonic, so a parent's own
    edge and its reports' edges only meet at the parent.
- The physics keeps each node inside its slice (an angular clamp around the hub in `orgStep`), so settling,
  a drag release and a re-parent all end inside the slice.

## Decisions (mine, reversible)
- Weight by leaf count, not subtree size: leaves are what fill the outer ring.
- The flat-fleet path is left as it was.

## Measured (2026-09-28, on origin/main 41e887303 + this branch)
- web.org-sectors-4434.test.js on MAIN's code: 6 of 8 red. The uneven tree crosses on first paint (c3 x d1);
  random tree seed 8 crosses; it crosses after settling and after a re-parent; there are no sectors.
  Saved output: scratchpad os-red-on-main-41e887303.out.
- On this branch: 8/8, and web.org-view.test.js + org-reduced-motion-settle-1738.test.js stay 31/31
  (the #352 centring, the spill, depth-keeping, no-overlap and drag tests unchanged).
- Stress (a scratch copy of the test): 400 random trees up to 70 agents on first paint, and 300 up to 67
  agents after settling: no crossings, no overlaps.
- Mutations, each turning its own test red: no sector clamp in orgStep (the re-parent test); no tangent cap
  in orgPlace (the LOPSIDED tree: m1 x x9, c2 x x9, found by searching lopsided trees); orgLiveStart not
  passing lo/hi (the wiring test).
- A tangent clamp in orgStep was tried and REMOVED: it was written for a crossing that turned out to be a
  test artifact (a fixed box smaller than a big tree pinned its outer ring to the edge), and with the test's
  canvas sized as paintOrg sizes it, the sector clamp alone holds over the 300 settled trees.
