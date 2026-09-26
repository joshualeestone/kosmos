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
- plusStarsInit sizes from the canvas's own layout box (clientWidth/Height). (Pass 1 measured that the
  ResizeObserver is what fixes the ovals; sizing from the canvas rather than the parent is kept because
  it is the box the buffer is drawn onto, and clientWidth ignores transforms where a rect would not.)
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

# #3780 (same PR): the Kosmos+ page no longer says sign-up is not open (Josh, 13:12: "Join works")
- The paragraph "Sign-up is not open yet. When it opens it happens on the Kosmos website ..." is now
  Splinter's copy (reversible): "Joining takes a minute on the Kosmos website: your email, a code to
  confirm it, and your card. Then sign in here, and this computer gets an address of its own. Nothing
  to configure on your router." It carries id="plus-join-line".
- Grep: the only other "not open yet" hits are comments (engine/remote.js:111, server.js:6653, and the
  new comment recording the old sentence). svcDoorText's "Coming soon" is about service connections,
  not sign-up. No help tip or guide text says sign-up is not open.
- web.plus-signup.test.js anchors on the paragraph's id and its control on the new sentence;
  web.plus-tab.test.js asserts the new sentence and the absence of "not open yet" (comments stripped,
  so a comment quoting the old sentence cannot satisfy or trip it); red with the old sentence back.
- Shots: ~/.cache/claude-handoffs/shots-3780 -> the #3778 before/after (same page, both changes visible).

## Review pass 1 (opus) on #3778: 0 blockers, 1 warning, 4 nits
- W a blank frame on every observer-driven re-size (setting width clears the canvas and the observer
  runs after that frame's rAF) -> plusStarsStart draws one frame at once; arm samples pixels from a
  later observer before paint: 4009 lit, 0 without the fix (red).
- N the rect sizing was untested and transform-sensitive -> clientWidth/Height, plan corrected.
- N the disconnect arm passed when no observer was ever made -> an arm asserts the watcher runs on Kosmos+.
- N the 1400x900 resize arm cannot fail there (the box does not move); it bites at 900x700. Not taken.
- N re-seeding on every change: the named weakest premise.
