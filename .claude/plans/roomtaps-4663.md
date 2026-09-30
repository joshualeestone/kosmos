# roomtaps-4663: the project page's small controls take a thumb-sized tap on a touchscreen

Card: kosmos#4663 (Mona Lisa's phone audit, 2026-09-29).

## Done looks like
On a touchscreen, Back (#pj-back), the settings cog (#pj-settings-link), + Add member, + New task and both View
All links each take a tap across at least 36px around their centre (the room's --room-tap), with nothing drawn
moved or grown, and no enlarged area taking a neighbouring control's own centre.

## Cause
They are drawn 22 to 28px (mobile-shots' tap audit at 393 and 375 in WebKit), under the room's own 36px, which the
reaction bar already meets. Back is the one people use most.

## Decisions
- An invisible ::after centred on each control, max(100%, 36px) square, under @media (hover: none). The + buttons
  are 22px bordered circles on a grid; padding with a negative margin would grow the drawn circle.
- 36px, the room's --room-tap (#3811), not 44: these sit in tight headers beside other controls.
- In the one-screen layout, + New task and the tasks View All sit at the top (+ New task also at the right edge) of a
  column that clips (overflow: hidden, needed for its scroller), which cut a centred area to about 30px. Their areas
  grow inward there (down from the top; left from + New task's right edge). The column is not changed.
- There, + New task's inward area reaches 14px left of its drawn edge against an 8px gap to View All, so View All
  steps 8px left in that layout on a touchscreen (6px needed, 2px for sub-pixel layout): the one drawn change, and
  only there (review round 3 measured 18% of View All answering as New task before it).
- Back is not shown in the one-screen layout (its crumb row is display:none), so it is not measured there.
- Rejected: enlarging the drawn controls (a visual change the card did not ask for).

## Weakest premise
That an ::after tap area never covers a neighbour in states this check does not draw (a long project name pushing
the cog, a member list longer than the sample). The neighbour arm checks every control within 40px in the sample.

## Checks
- render-room-msgbox-2806, one in-page helper (tapProbe4663) that measures each control's REAL tap extent: every point
  of a grid around it (the control scrolled to mid-screen) that reaches it, and the box those points span, which must
  be at least 35x35. Shape-agnostic, so it measures a centred area and an inward one alike. Runs on: phone 375 (tab
  layout), touch tablet 1180 (tab layout, all six), and the ONE-SCREEN layout set for real (data-layout=consolidated,
  body.consolidated) at 1024 and 1180 (five: Back is not shown there). Also: no button or link within 40px has more than 1% of
  its drawn box (every pixel sampled) answering as one of the areas (round 3: a centre-only test missed an edge overlap), and the probe restores every change (hidden, inert, inline display, scroll positions),
  checked by a before/after snapshot.
- Red on origin/main's page (every reach arm); red in the one-screen arms with the inward rules removed (+ New task
  36x30, View All 44x31); the neighbour arm red without View All's step (16%, and 2% at a 6px step); the restore arm
  red with the undo removed.
- The first tablet arm (round 1) claimed the one-screen layout and never drew it; review round 2 found it, and the
  layout it missed was the one where the fix failed.
- Not measured: states the sample does not draw (long names, long member lists): the weakest premise above.
- mobile-shots' tap audit still lists these (it measures drawn boxes, not hit areas); that is expected.
