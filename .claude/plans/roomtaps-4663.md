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
- Rejected: enlarging the drawn controls (a visual change the card did not ask for).

## Weakest premise
That an ::after tap area never covers a neighbour in states this check does not draw (a long project name pushing
the cog, a member list longer than the sample). The neighbour arm checks every control within 40px in the sample.

## Checks
- render-room-msgbox-2806, one in-page helper (tapProbe4663) run on the phone page (375, tab layout) and the touch
  tablet page (1180, one-screen layout): each of the six, scrolled to mid-screen, is hit at four on-screen points on
  its 36px box; no button or link within 40px loses its own centre to one of them; and the probe puts back every change
  it made to reveal them (hidden, inert, inline display, only forcing display where it computed none), checked by a
  before/after snapshot, so later arms see the real layout (review round 1).
- Red on origin/main's page (both reach arms); the restore arm is red with the undo removed.
- Not measured: partial overlap of two enlarged areas with each other (the sample's gaps are 8px against 7px of growth
  a side), and states the sample does not draw (long names, long member lists): the weakest premise above.
- mobile-shots' tap audit still lists these (it measures drawn boxes, not hit areas); that is expected.
