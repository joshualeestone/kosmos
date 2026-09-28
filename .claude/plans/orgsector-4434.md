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

## Browser check (docs/browser-checks/render-org-sectors-4434.js), measured behind heavy-gate
- Wired in tools/browser-checks.sh on its own board (P17, a 17th port from pick_ports), seeded by
  write_fleet_org with an optional tree: fifteen agents, five managers with uneven teams and depths.
- It counts crossings among the wires AS DRAWN, after the chart settles, animated and reduced-motion, and
  keeps a screenshot. Non-vacuity in-check: all agents drawn, one wire each, at least three managers, and a
  control pair for the crossing count.
- RED on main 41e887303 (1 crossing, n4 x n5, in both modes); GREEN on this branch (0 crossings in both).
- Found on the way: my first board (the UNEVEN tree) was GREEN on main, because main's physics untangles it
  once it settles. A check that cannot fail on main guards nothing, so the board is a tree that crosses on
  main even after settling (the node test's seed-8 random tree).

## Rework after review it1 (a BLOCKER: my "sector clamp alone holds" was wrong, from too narrow a sample)
- Placement: the tangent cap applies only to a manager that has a manager (only then can a report's line dip
  across its grandparent's line); a first-ring manager's reports stay within ~85 degrees of it, so no line
  sweeps past the hub. Capping every manager made one with six plain reports outgrow a phone.
- Physics: the hard sector clamp is gone (it made released nodes jump 50-95px). In a tree, each node is pulled
  back to its placed position relative to the hub (ORG_SIM.home 0.08), and its parent spring rests at the
  placed edge length (orgStep's ORG_STEP rest pulled grown rings back in). A flat fleet has neither and moves
  exactly as on main.
- Measured with the reviewer's harness (scratchpad os-rw/, which builds nodes like orgLiveStart): settled
  crossings 0/1000 (8-25 agents) and 0/150 (30-60) at natural, 375px and 1000px widths; 60-90 agents
  squeezed to a phone or 1000px box: 9/150 (pRoot .33) and 3/150 (.15), 0 overlaps. KNOWN LIMIT, decided:
  a stronger home pull (0.15, 0.3) cut those crossings to 2/150 and 1/150 but made faces OVERLAP (3 and 31
  cases), which is worse. Flat drags: release jump 1-5px (main-like). Tree drags: after a release and
  settle, 2/120 keep a crossing (a drag is a gesture, not in the card's done-when). Phone fit for a
  manager with 3-8 reports: identical to main.
- render-org-reduced-motion (#1870): its premise (the static layout overlaps on the dense board) is gone by
  design; first paint 64px, settled 66px. DENSE_MAX raised 64 -> 72 (still reds a flat board at 114) and
  the header/label now say what it pins. The settle's own overlap resolution stays pinned in node
  (org-reduced-motion-settle-1738).
- New tests: settle drift < 85px (placed rest 61.5 vs ORG_STEP rest 110.9), no non-hub line within 74px of
  the hub (with the 85-degree limit 108.7; without 28.3), a bigger branch gets a wider slice. Mutations each
  red: no cap, no home pull, no placed rest, no root limit, even weights. Unarmed by design: the 0.9 margin.
