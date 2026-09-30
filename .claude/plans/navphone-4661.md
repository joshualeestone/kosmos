# navphone-4661: the phone DM's section row shows every button whole

Card: kosmos#4661 (Mona Lisa's phone audit, 2026-09-29).

## Done looks like
On a phone with the Direct Message open, the agent's section buttons (Direct Message, Profile, AI Settings,
and a swarm's fourth) sit in one row the page's width, every button whole, no word broken, nothing scrolling.
At 375 and wider with default text the row keeps its 44px height; narrower, or with larger text, a label may
wrap to a second line between words (measured, three buttons: 59px at 320 and 360, 67px at 375 with 130% text).
A swarm's four buttons stay one row at default text for every status word (Active, Stopped, Paused (limit));
at 130 to 150% text on a 320 phone they wrap to two rows, and at 150% on 320x568 the conversation keeps 46px, the
real cost of four whole words there. Chromium and WebKit.

## Cause
The row was a sideways scroller (a 32px fade on the right was its only cue). At 393 and 375 wide the
third button was cut mid-word ("AI Se"), so it read as broken, not scrollable.

## Decisions
- A wrapping row of equal shares (flex: 1 1 0), each button never narrower than its longest word
  (min-width: min-content), icon above a .75rem label, instead of the scroller. 44px at 375+ with default text.
  A grid of equal columns (the first version) spilled words out of their buttons when four did not fit (a swarm's,
  at 130 to 150% text on a 320 phone: "Settings" is wider than a quarter of the screen), which review round 2
  found; the old scroller hid the same problem. Now only that case wraps to a second row.
- A swarm's status word keeps its word and drops its colour dot in this row (the dot only repeats the word), and
  may wrap between its own words ("Paused (limit)"), so a long status does not widen its button until the row wraps.
- With the icons gone (swarm row) the needs-you dot moves into the corner and the buttons' labels start 13px down,
  below it (review round 3 found the dot drawn over "Direct Message" at 320).
- When the row does wrap (the extreme text sizes above), a lone button on the second line takes the full width. That
  reads as three tabs and a banner; it is the accepted fallback, not the normal shape.
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
- render-dm-chatfirst-718, one shared in-page measure (navGeo), which also counts each label's lines (a legal
  break is at a space, including a zero-height one, or after a hyphen): one row by geometry (it read flex-direction, a
  proxy the grid broke while the row stayed one row), every tab whole, no scroll, and no word broken, measured per
  character (a line change with no space either side). Arms: 375 to 430 at 44 to 52px; 320, 360 and 375 at 130%
  text (at most two label lines, thread at least 60px); the swarm row (four buttons, at most 60px) and the swarm
  row, at 375 and 320, at 130 and 150% text (may wrap; nothing cut, clipped, or outside its button: a per-button
  containment measure added in round 2). Red on origin/main (scrolls); red with overflow-wrap: anywhere put back
  (cuts in Direct Message, AI Settings, Swarm Settings); red on the equal-columns grid (words out of their buttons
  by 1 to 6px at 320). Chromium and WebKit.
- render-dm-sideways-3969, render-swarm-ui-3564, render-agent-nav: unchanged and green.
