# orbboot-8354: the boot cover shows the orb from the first paint (kosmos#8354)

Josh, 11-10 11:24: "I keep getting both spinners. I'll see a giant dot one and then it'll flip to the cool Kosmos one."

## Done when
Served on PROD: opening the Mac app shows the orb from the first frame to the board, no dots at any point, on a cold start and on reopening the window. A browser check proves the first paint; the app itself is checked on the Mac after release.

## Cause
#boot-cover's markup is the Sweep dots; the orb is a canvas KORB draws from the page's main script, about two seconds in.

## Change
CSS only: until `.korb-on`, the cover hides the dots and shows one still frame of the orb, KORB's own reduced-motion frame (K facing, 2x), as a mask over --spin-gold so it takes the theme's colour.

## Decisions
- Rejected moving KORB into an early script: 250 lines, and tests lift it from the main script; it still could not draw before that script parsed and ran.
- Still, not animated, for those two seconds: CSS cannot run the orb. Rejected a hand-made CSS animation, which would be a third look.
- Only #boot-cover: every other .orb-wait is inserted by the script, after KORB exists.

## Weakest premise
That the dots Josh saw are this cover. Reading the page says yes (88 px, centred, the same place), and the still frame cannot be confirmed on the Mac app until a build carries it.

## Checks
render-orbboot-8354, render-boot-no-flash and both gutter checks pass on this branch (29 PASS, 0 FAIL).
