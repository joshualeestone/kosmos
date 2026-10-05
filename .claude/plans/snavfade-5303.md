# snavfade-5303: the phone Settings row says there is more (kosmos#5303)

Measured first (375x667, main df55e789b, Chromium + WebKit, light + dark, classic + new look): #718's 32px right-edge fade
was there, but too weak to read as "more" (a fading word reads as clipped text, worst in the new look's borderless pills).

## Finished looks like
- At phone width the fade follows the scroll (data-edge on #s-nav: r, lr, l, or none): right while there is more to the
  right, left once the row has moved, none when it does not scroll.
- A "More sections" chevron (#s-nav-more, 44x44, solid, at the row's real right edge) shows while there is more to the
  right; a tap moves the row 70% of its width (no smooth scroll under reduced motion); it goes at the end.
- Desktop and the 920px column are unchanged (no chevron).
- render-settings-nav.js asserts all of it in both themes, the new look's background included, with a 920px control. A
  mutation control (the chevron back to one id + a class) fails the new-look assertion in both themes.

## Decided
- Chevron + scroll-aware fade. Rejected: a wider fade alone (still reads as clipping).
- The chevron sits inside the nav (position: sticky; right: -32px, cancelling the row's end padding) with no data-go, so
  the nav's click handler and the Settings menu pass it by. Two-id selectors, because the new look's nav-button rule
  outranks one id and a class.
- The fade stops just before the chevron's 44px so the chevron itself is not faded.

## Weakest premise
That one small chevron is not over-illustration (Josh prefers subtle). It shows only on a phone, only while there is more.
