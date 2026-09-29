# navphone-4661: the phone DM's section row shows every button whole

Card: kosmos#4661 (Mona Lisa's phone audit, 2026-09-29).

## Done looks like
On a phone with the Direct Message open, the agent's section buttons (Direct Message, Profile, AI Settings,
and a swarm's fourth) sit in one row the page's width, every button and label whole, nothing scrolling,
at the same 44px height as before. Chromium and WebKit, 375 to 412 wide, light and dark.

## Cause
The row was a sideways scroller (a 32px fade on the right was its only cue). At 393 and 375 wide the
third button was cut mid-word ("AI Se"), so it read as broken, not scrollable.

## Decisions
- One row of equal columns, icon above a .75rem label, instead of the scroller. Same 44px height.
- Rejected: two rows (Direct Message full width, then the pair). It is the desktop shape, but here it takes
  about 50px from the conversation on the screen people use most (an SE's thread gets about 220px).
- Rejected: a stronger scroll hint. It still hides one of only three choices.
- A swarm's fourth button may wrap a label to two lines (`text-wrap: balance`) rather than scroll.
- "Direct Message" keeps its words (Josh's #4550 label).

## Weakest premise
That a .75rem label under an icon is legible enough on a phone. It is the size of the room's timestamps; if
it reads as too small, the next step is icon-only for Profile and AI Settings with the words as their names.

## Checks
- render-dm-chatfirst-718: "one row" is now measured by geometry (it read flex-direction, a proxy the grid
  broke while the row stayed one row), plus two #4661 arms: every tab and label whole with no scroll, and the
  row's height 44 to 56. Red on origin/main (whole:false, scrolls:true), green here, Chromium and WebKit.
- render-dm-sideways-3969, render-swarm-ui-3564, render-agent-nav: unchanged and green.
