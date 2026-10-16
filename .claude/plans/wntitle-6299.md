# wntitle-6299: the What's New title keeps its lines apart when it wraps (#6299)

Found in the 0.7.51 staging visual check (#6300). It is not a 0.7.51 blocker (Splinter agreed), and it rides 0.7.52.

## Finished looks like
At phone width the window's title ("Kosmos has been updated to 0.7.51") wraps without its two lines overlapping, in
light and dark. Desktop still shows one line.

## Cause (measured)
`body` sets `line-height: 16px`, an absolute length, and the 24px `.wn-title` inherited it, so a wrapped title drew its
lines 16px apart at a 24px font. The style was unchanged since #4077 (September), so every release showed it on a phone.

## Done
- `.wn-title`: `line-height: 1.2`. Measured at 393 px: line gap 29 px at a 24 px font. At 1280 px: one line.
- `docs/browser-checks/render-whatsnew-title-6299.js` (in gated.txt and the README): opens the real window with
  web/whats-new.json, no board, in Chromium and WebKit. It asserts the title wraps at 393 px and its lines are at least
  one font size apart, one line at 1280 px, and no page error. Main's CSS turns the spacing arm red (gap 16).

## Decided
- On desktop the one-line title is about 13 px taller. 1.2 is a normal heading line-height; the margins are kept.
- The check asserts no overlap (at least one font size), not a minimum gap.
