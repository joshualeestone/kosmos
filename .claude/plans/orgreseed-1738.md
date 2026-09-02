# orgreseed-1738: org chart overlaps under reduced motion (kosmos#1738)

Card: kosmos#1738 (priority). Repo: agent-workforce.

## Diagnosis (building on Baron's measurement, NOT re-derived)

Baron proved the collision MATH works: lifting the real orgStep/orgPlace and
running to convergence gives 0 overlaps for synthetic fleets and for Josh's real
flat 18-node fleet, static AND converged. So the collision term is NOT the bug -
do not touch it.

The bug is rendered STATE, in orgLiveStart:
1. It seeded each node from ORG_POS (last positions). After a fleet change the
   stored positions belong to a DIFFERENT fleet and can overlap.
2. Under prefers-reduced-motion it set alpha 0, painted once, and called
   orgLiveRun() only when motion was allowed (`if (!still) orgLiveRun()`). So a
   reduced-motion user never got the relaxation - an overlapping seed was
   PERMANENT for them. Accessibility defect, not cosmetic: it lands on the users
   who opted out of motion, and no interaction clears it.

## Fix (web/index.html)

- reduced motion means do NOT ANIMATE, not do not LAY OUT. New orgLiveSettle()
  runs the same relaxation orgLiveRun animates, synchronously and bounded
  (ORG_SETTLE_STEPS, no requestAnimationFrame) - no motion, but a settled layout.
- (Considered and DROPPED per blind review: a fresh-seed-on-fleet-change gate.
  It was all-or-nothing, so it re-animated the whole motion-path chart on any
  membership change - a behaviour change beyond the reduced-motion fix - and it
  was redundant: the settle (reduced-motion) and orgLiveRun (motion) both
  converge from ANY seed, so the stale seed only affects the transient
  animation, not the final layout. Kept per-key ORG_POS seeding unchanged.)

## Verification

- Existing render-org-chart.js (8 assertions) still PASS against a booted rich
  fixture (chart draws, centres, fills) - the fix does not regress the drawing.
- org-reduced-motion-settle-1738.test.js: a deterministic node guard. It lifts
  the REAL orgStep out of web/index.html, seeds nodes overlapping (a stale
  ORG_POS), and asserts the settle resolves them to 0 overlaps; plus a wiring
  guard that orgLiveStart calls the settle under reduced motion and carries no
  skip. Perturbation-proven both axes: revert the wiring -> wiring test reds;
  ORG_SETTLE_STEPS=0 -> behavioural test reds.

## Why a node test and not a render-org-chart.js reduced-motion arm

The defect only shows with an overlapping seed. The runner fixture is 5 flat
agents, whose static orgPlace is 0 overlaps (Baron), so a reduced-motion arm on
that fixture is green on main, after the fix, and on a revert - aimed at the arm
where the defect does not exist (Splinter's own warning). Manufacturing overlap
in the browser either fights the sim (a motion drag re-separates) or needs a
denser fixture that breaks render-org-chart.js's fill-band assertion. The node
test controls the seed directly and runs the real orgStep, so it reds on a
revert without any of that. A browser arm would need a denser org-chart fixture
(a separate fixture change).
