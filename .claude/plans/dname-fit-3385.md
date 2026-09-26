# #3385 follow-up: the agent name fits the left column, on desktop and on a phone

Found in Mona Lisa's visual closeout of #3385 (2026-09-26), from origin/main renders: a 40-letter name
("Maximiliana Montgomery-Featherstonehaugh") was cut with an ellipsis at 10.7px on desktop (the floor is
0.55rem, about 8.8px) and at 18px on a phone. Josh's ask (#3385 item 2): the name never wraps, it
shrinks to fit the column however long it is.

## Done looks like
A long name that can fit above the 0.55rem floor is drawn whole on one line, at desktop widths and in
the phone Talk view; a short name keeps 1.5rem (desktop) and 18px (phone Talk); a name past the floor is
cut with the ellipsis, as designed.

## Causes, measured
1. Desktop: one proportional step (size x avail/natural) undershoots, because the system font draws small
   text relatively wider (optical sizing): 10.7px measured 240px in a 220px column.
2. Phone: the Talk view set `font-size: 1.125rem` on #d-name outright, which overrode the fit's
   --dname-size, so no fit applied there at all.

## Calls
- fitDetailName measures again at the size it set and corrects, up to six times, from the size the name
  is DRAWN at, stopping at the floor; 0.99 of the ratio so rounding cannot leave it a pixel over.
- The phone Talk rule is `min(1.125rem, var(--dname-size, 1.125rem))`: 18px stays the most, the fit can
  take it smaller. Rejected: letting the phone use the 1.5rem base (breaks the compact phone header).
- The fit re-runs on a section change (detailGo), since the phone draws the name at different sizes in
  Talk and Profile. Weakest premise: that six passes always converge; each pass shrinks by the measured
  ratio, and the loop is bounded by the floor, so the worst case is the ellipsis, as before.

## Check
render-detail-header-1841 Part 5: the 40-letter name fits whole on desktop (above the floor); the
51-letter one is cut only at the floor; on a 412px phone Talk view a long name shrinks (12.3px, no
ellipsis) and a short one keeps 18px. Both arms red on origin/main.

## Review round 1 (sonnet)
- FIXED: the resize handler called the (now up to six-pass) fit on every event; coalesced to one per
  frame (DNAME_RESIZE_RAF, the ORG_RESIZE_RAF pattern). Comment updated to name all four fit sites.
- ANSWERED: geometry arms under headless rendering. Every run of the new arms, and their controls, was
  HEADED=0 (SwiftShader, as CI and the nightly run): the 40-letter name fits at 0.607rem, well clear of
  the 0.55rem floor, and the phone name lands at 12.3px, well under 18px, so neither sits on a boundary.
- KEPT: the typeof guard on the detailGo call (harmless; protects a test that lifts detailGo alone).

## Review round 2 (opus)
- FIXED: nothing checked the section-change refit (detailGo). New phone arm: Talk to Profile re-fits (0.766rem to 0.931rem, whole), and back to Talk returns to the Talk fit, whole. Red with the refit removed.
- NIT, commented rather than changed: openDetail fits at once and detailGo fits a frame later (after the swarm avatar slot is sized); both kept.
- NIT accepted: the one-per-frame resize coalescing has no check (performance only).
