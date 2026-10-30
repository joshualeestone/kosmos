# composerwhite-7628: no grey band behind the iPhone chat's input box

Card: kosmos#7628, Josh 10-30 12:30 on TestFlight build 21: "Let's make the background behind the input box also white. Looks weird now ... We could still have the soft fade".

## Measured, not assumed
Josh's screenshot (build 21, light, keyboard up): the chat 255, beside the input box 249 to 253, inside the box 255. The strip behind the box was already the chat ground (#7631); the grey was the box's soft shadow (black 10%, radius 10, y 3), a wide halo that blended into the old #faf9f7 ground and shows as a band on white. My own build-21 simulator shot shows the same (251 to 254 beside the box).

## Change
The DM and room input boxes take a tight shadow (black 8%, radius 3, y 1): the white box on the white ground keeps an edge without the band. The fade above the strip (#7346) is unchanged, as Josh asked.

## Verified
Simulator (iPhone 17 Pro, iOS 27.0), DM keyboard down and up, room, light and dark: beside the box now 254 to 255 (was 249 to 253), a thin 252 line only at the box's own bottom edge.

## Rejected
No shadow at all: the white box would rest on its 0.5 pt hairline alone (about 1.3:1 on white), too faint to read as a box.

## Weakest premise
That the tight shadow reads as an edge, not a band, on a real phone's display (simulator pixels are not the OLED). Josh looks at it in the next TestFlight build.

## Review ledger (1 blind round, converged)
- Round 1: CONVERGED, no blocker or warning. It confirmed from Josh's own pixels why the halo read as a band: the fade over the strip (solid ground at its lower end) cut the old shadow's top off in a straight line 6 pt above the box; the new shadow ends inside that gap. NIT (not taken here): rooms have no fade into the input area at all (DMs do), already so before this branch; raised on the card for Josh.
