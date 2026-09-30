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
- render-room-msgbox-2806 [phone] two arms: each of the six, scrolled to the middle of the screen, is hit at four
  points on its 36px box (all on screen); and no button or link within 40px loses its own centre to one of them.
  Red on origin/main (all six false), green here. The first version counted an off-screen point as reached, so Back
  and the cog passed on main unmeasured; fixed before commit.
- mobile-shots' tap audit still lists these (it measures drawn boxes, not hit areas); that is expected.
