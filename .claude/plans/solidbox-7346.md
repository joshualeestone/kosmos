# solidbox-7346: the DM box sits on a solid strip that messages fade into

Card: kosmos#7346 (Josh 10-27 19:59 and his follow-up, relayed by Splinter): "make the background behind the input box
solid like Discord so you don't see text scrolling back behind or below it", "maybe with a slide fade into it so it
looks smooth".

## Finished looks like

In a DM on the iPhone, the strip behind and below the floating box (down to the home indicator) is the screen's solid
background, no message shows through or under it, the list ends above the strip, and messages fade into it over a
short gradient instead of a hard edge.

## Decided

- The bottom inset that holds the box gets Palette.ground, extending under the home indicator; the strips above the
  box (reply, files, dictation line, the note) are solid too (they were 94% opaque).
- The fade is an 18 pt gradient drawn over the list above the strip (no room taken, no touches, hidden from VoiceOver).
- The room's box is not changed: it sits below its list, not over it, so nothing scrolls behind it.
- Weakest premise: 18 pt reads as "smooth" to Josh; Mona Lisa may tune it.

## Verify

LogicTests run.sh and run-composer.sh, the iOS 16 simulator typecheck, light and dark DM shots
(~/work/design-shots/kosmos-7346-solid/).

## Review bound

Challenge loop to convergence. Merge on green. Goes in TestFlight build 9.
