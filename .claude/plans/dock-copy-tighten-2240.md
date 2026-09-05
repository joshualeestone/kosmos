# dock-copy-tighten-2240: light wordsmith of the first-run Success Dock line

## Goal
kosmos#2240 (Splinter relaying Josh, ship-it): a tighter wordsmith of the first-run Success Dock line,
keeping the two-instances fix (Kosmos is already in the Dock, drag its icon to the far left).

## Change (one line, web/index.html:8021, #fr-return-keep)
Dropped the bold "Keep it one click away." lead, which was redundant with "so it stays handy" at the end
of the same sentence. Kept everything else.
Before: "<b>Keep it one click away.</b> Kosmos is already in your Dock, the strip of icons along the edge
of your screen. Drag its icon to the far left so it stays handy."
After: "Kosmos is already in your Dock, the strip of icons along the edge of your screen. Drag its icon to
the far left so it stays handy."

## Decisions
- KEPT the "the strip of icons along the edge of your screen" explainer: a first-timer needs to know what
  the Dock is, AND it is test-guarded (server.test.js:5448 DOCK regex, render-first-run.js:515). Dropping
  it would break guards + remove intentional help. My first instinct (a fully tight line) was wrong here.
- Dropped only the redundant bold lead ("Keep it one click away" is not test-guarded, verified).
- Left #2258 Settings reveal line as its own tight version ("Drag it to the far left") since it shows the
  icon adjacent, so "it" has a visual referent and no Dock explainer is needed. The two are appropriately
  in step (both fix two-instances), not identical, because their contexts differ.
- #1720 gate: copy-only, Browser-check: trailer on the commit; the guarded substring is intact.
- Weakest premise: that dropping the bold lead is the wordsmith Josh wants vs a reword of the drag line.
  The 4 posted options on #2240 stay for him to swap to any; reversible.

## Verification
- Guarded substring "Kosmos is already in your Dock, the strip of icons" intact (grep=1).
- "Keep it one click away" not test-guarded (grep empty), safe to drop.
- Full tools/run-tests.sh run (box free, no cut): PASSED, exit 0 (all dock guards green).
