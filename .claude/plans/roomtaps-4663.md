# roomtaps-4663: the project page's small controls take a thumb-sized tap on a touchscreen

Card: kosmos#4663 (Mona Lisa's phone audit, 2026-09-29).

## Done looks like
On a touchscreen, Back (#pj-back), the settings cog (#pj-settings-link), + Add member, + New task and both View
All links each take a tap across at least 36px (the room's --room-tap), and no enlarged area takes any part of a
neighbouring control, the first task card and the first file row under their headers included. In the one-screen
layout that means the four controls it shows (Back and + Add member are not drawn there). Drawn changes only
in the one-screen layout on a touchscreen (below).

## Cause
They are drawn 22 to 28px (mobile-shots' tap audit at 393 and 375 in WebKit), under the room's own 36px, which the
reaction bar already meets. Back is the one people use most.

## Decisions
- An invisible ::after on each control, max(100%, 36px) square, under @media (hover: none). The + buttons
  are 22px bordered circles on a grid; padding with a negative margin would grow the drawn circle.
- Back, the cog and + Add member have room all round, so theirs is centred. The two View All links and + New task sit
  2 to 6px above the first file or task (measured in WebKit), so theirs grows up and sideways only, never below the
  control's bottom edge (review round 4 measured a centred area taking the top 3 to 6% of the first file row and the
  first task card).
- 36px, the room's --room-tap (#3811), not 44: these sit in tight headers beside other controls. The variable is
  defined on the conversation element, which these sit outside, so 36 is written in the CSS and asserted as a literal
  in the check: if the room's value changes, these do not follow (accepted, named in both comments).
- Touch means (hover: none), as the room's own rules use; a tablet with a trackpad reports hover and keeps the drawn
  sizes, which a pointer can hit.
- In the one-screen layout, + New task and the tasks View All sit at the top (+ New task also at the right edge) of a
  column that clips (overflow: hidden, needed for its scroller), and the first task is right under them, so there is
  no room up or down. The tasks header gains 14px above it there on a touchscreen, which their areas grow into
  (12px measured 35px tall; 14 gives 36 to 37); + New task's grows left from its right edge. Round 3's inward-down
  areas were replaced in round 4: they reached into the first task card.
- There, + New task's inward area reaches 14px left of its drawn edge against an 8px gap to View All, so View All
  steps 8px left in that layout on a touchscreen (6px needed, 2px for sub-pixel layout) (review round 3 measured 18%
  of View All answering as New task before it). With the 14px above, those are the two drawn changes, both only in
  the one-screen layout on a touchscreen.
- Back (crumb row display:none) and + Add member (Members card display:none, #3218) are not shown in the one-screen
  layout, so neither is measured there; forcing Members visible also reflowed the Files card (review round 4).
- Rejected: enlarging the drawn controls (a visual change the card did not ask for).

## Weakest premise
That an ::after tap area never covers a neighbour in states this check does not draw (a long project name pushing
the cog, a member list longer than the sample). The neighbour arm checks every control within 40px in the sample,
which now draws one task and one file (round 4: with empty lists it had nothing under a header to measure).
Its neighbours are buttons, links, fields, anything focusable, role=button, role=link (the parent-project crumb beside Back, 6px away) and member
rows (.pj-member[data-agent], which open an agent); the probe draws one crumb and two members too (round 8). No field
sits within 40px of these six today.
Not checked by an arm: the one-screen touch header's extra 14px takes 14px off the task list's visible height. The
list scrolls (overflow-y: auto), so nothing is cut off, only one more scroll sooner.

## Checks
- render-room-msgbox-2806, one in-page helper (tapProbe4663) that measures each control's REAL tap extent: every point
  of a grid around it (the control scrolled to mid-screen) that reaches it, and the box those points span, which must
  prove the area reachable across its size. The SIZE is the area's own used width and height (getComputedStyle
  ::after), at least 36x36, which is exact; the grid must then span that size to within 1px, so a clipped area fails.
  Two halves because hit-testing cannot see below a pixel: both engines round the asked point to a whole pixel, so a
  36px area reads 36 or 37 by where it sits and a 35px area could read 36 (rounds 6 and 7; a binary search to 1/64px
  read 37.0 for 36 and passed a 35px area, measured). The hits must also FILL the area, at least (size-1)^2 points,
  not only span it (round 8: a 36x12 overlay across + Add member's area kept a 37x37 span). Not caught: clipping or
  covering under 1px. Shape-agnostic, so it measures a centred area and an inward one alike. Runs on: phone 375 (tab
  layout), touch tablet 1180 (tab layout, all six), and the ONE-SCREEN layout set for real (data-layout=consolidated,
  body.consolidated) at 960, 1024 and 1180 (four: Back and + Add member are not shown there; 960 is the layout's narrowest width). The probe draws one task
  and one file first and asserts both rows are drawn (subjects [1,1]), and puts the lists back after. Also: no button or link within 40px has ANY pixel of
  its drawn box (every pixel sampled) answering as one of the areas (round 6: a 1% share let a 6px strip across the
  first task card pass) (round 3: a centre-only test missed an edge overlap), and the probe restores every change (hidden, inert, inline display, scroll positions),
  checked by a before/after snapshot.
- The neighbour arm red on round 3's page (044f6aa73) with the seeded rows, WebKit: pj-doc 3% (phone), 5% (tablet
  tabs), tkcard 6% and pj-doc 6% (one-screen 1024 and 1180). Green on this head, Chromium and WebKit.
- The phone arm now runs after the focus-turn arm puts back its forced display (round 4: it measured an altered page).
- Round 10: an arm on a hover page (1180, tabs and one-screen, both engines) asserts none of the six has an area and
  neither one-screen drawn change applies; red with the touch gate removed (all six listed), which every other arm
  passed. The neighbour set widened to fields and focusable elements (clean in both engines).
- Round 8 controls, WebKit: an overlay across + Add member's area's middle is red (888 hits of 1225); Back's area
  widened to 40px is red through the crumb link (32 px) in both tab arms. The one-screen rules sit under the same
  960px gate as the layout itself. The restore snapshot also compares every scrolled element, so a scroll the probe
  causes reads as not restored.
- Round 7 controls, both engines: every area at 35px is red in all eight reach arms (by size); the one-screen header
  room removed is red (+ New task and View All reachable only 23 to 24px tall though their areas are 36).
- Round 6 controls, WebKit: the list-adjacent areas pushed
  8px below their controls are red in all four neighbour arms (tkcard 90 to 106 px, pj-doc 360 px). The probe puts the
  page back in a finally, so a measurement that throws cannot leave later arms an altered page.
- Card #4663 asked for padding with a negative margin and for mobile-shots' tap list to stop naming these six. Neither
  fits: padding grows the drawn circles, and mobile-shots measures drawn boxes against 44px, so it lists them forever.
  The card carries the changed design and this done-condition in a comment.
- The restore snapshot covers the two lists' HTML and the page's task-list cache (TK_LIST_HTML, the repaint guard),
  which the probe puts back (round 5); red with the cache restore removed.
- Red on origin/main's page (every reach arm); red in the one-screen arms with the inward rules removed (+ New task
  36x30, View All 44x31); the neighbour arm red without View All's step (16%, and 2% at a 6px step); the restore arm
  red with the undo removed.
- The first tablet arm (round 1) claimed the one-screen layout and never drew it; review round 2 found it, and the
  layout it missed was the one where the fix failed.
- Not measured: states the sample does not draw (long names, long member lists): the weakest premise above.
- mobile-shots' tap audit still lists these (it measures drawn boxes, not hit areas); that is expected.
