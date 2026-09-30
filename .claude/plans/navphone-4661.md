# navphone-4661: the phone DM's section row shows every button whole

Card: kosmos#4661 (Mona Lisa's phone audit, 2026-09-29).

## Done looks like
On a phone with the Direct Message open, the agent's section buttons (Direct Message, Profile, AI Settings,
and a swarm's fourth) sit in one row the page's width, every button whole, no word broken, nothing scrolling.
At 375 and wider with default text the row keeps its 44px height; narrower, or with larger text, a label may
wrap to a second line between words (measured: 59px at 320 and 360, 67px at 130% text). Chromium and WebKit.

## Cause
The row was a sideways scroller (a 32px fade on the right was its only cue). At 393 and 375 wide the
third button was cut mid-word ("AI Se"), so it read as broken, not scrollable.

## Decisions
- One row of equal columns, icon above a .75rem label, instead of the scroller. 44px at 375+ with default text.
- Labels break only between words (overflow-wrap: normal). The first version used overflow-wrap: anywhere, which
  brought back the card's defect as "Messa / ge" at larger text sizes (review round 1).
- A swarm's fourth button carries its status word under its label; with the icon too the row grew to about 80px,
  so with four buttons the icons give way (56px measured).
- Rejected: two rows (Direct Message full width, then the pair). It is the desktop shape, but here it takes
  about 50px from the conversation on the screen people use most (an SE's thread gets about 220px).
- Rejected: a stronger scroll hint. It still hides one of only three choices.
- "Direct Message" keeps its words (Josh's #4550 label).

## Weakest premise
That a .75rem label under an icon is legible enough on a phone. It is the size of the room's timestamps; if
it reads as too small, the next step is icon-only for Profile and AI Settings with the words as their names.

## Checks
- render-dm-chatfirst-718, one shared in-page measure (navGeo): one row by geometry (it read flex-direction, a
  proxy the grid broke while the row stayed one row), every tab whole, no scroll, and no word broken, measured per
  character (a line change with no space either side). Arms: 375 to 430 at 44 to 52px; 320, 360 and 375 at 130%
  text (at most two label lines, thread at least 60px); the swarm row (four buttons, at most 60px) and the swarm
  row at 150% text. Red on origin/main (scrolls), and red with overflow-wrap: anywhere put back (cuts found in
  Direct Message, AI Settings and Swarm Settings). Chromium and WebKit.
- render-dm-sideways-3969, render-swarm-ui-3564, render-agent-nav: unchanged and green.
