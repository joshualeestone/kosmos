# #3778: Kosmos+ background dots render as ovals (Josh, 13:07)

## Cause, measured
- #plus-stars is stretched by CSS (position absolute, inset 0, 100%) over #s-sec-plus. plusStarsInit
  sized its buffer ONCE, one frame after mount, from the parent's clientWidth/Height. The section's
  height moves after that (its content paints in), so the buffer was drawn onto a different box and
  scaled unevenly: every arc became an ellipse. Measured on main at deviceScaleFactor 2: buffer aspect
  0.664 against displayed 0.817 at 1400x900; 0.753 against 0.956 at 900x700. Josh's screenshot is the
  same defect in the other direction (the section grew, so the dots stretched vertically).
- The window 'resize' handler could not see it: the window did not change size, the section did.

## Fix
- plusStarsInit sizes from the canvas's own displayed rect (getBoundingClientRect).
- plusStarsWatch: a ResizeObserver on the canvas re-sizes and re-seeds the field whenever its rounded
  box changes (content arriving, a column folding, a resize); disconnected in plusTeardown.

## Checked elsewhere
- #plus-mark (the wordmark) sizes itself: aspects agree within 1% (rounding). #fr-dots (first run):
  buffer and display agree exactly. The Kosmos+ sign-in wizard has no star canvas of its own; the
  installkosmos.com site is another repo and was not examined.

## Weakest premise
- A resize re-seeds the particles (new random positions) rather than scaling them: a visible jump on a
  resize, which is also what the existing window-resize handler already did.

## Tests
- docs/browser-checks/render-plus-stars-3778.js: 12 arms (two sizes). RED on main (6 arms).
- Shots: ~/.cache/claude-handoffs/shots-3778/{before,after}/3778-{1400x900,900x700}.png.
