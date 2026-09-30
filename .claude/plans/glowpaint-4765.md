# #4765 cause 2: the working glows fade a layer instead of repainting the box

Card: joshualeestone/kosmos#4765 (claimed:angel, priority). Branch glowpaint-4765, off main 001612050.
Addresses #4765 (cause 1, the room fan-out, is branch roomfanout-4765).

## What finished looks like
The Agents view, left alone with agents working, keeps the page's main thread nearly idle, as it is with no agents
working, and the working glows look the same as before: the card's slow green pulse (#3956) and the Working pill's
breath.

## Evidence (measured, headed Chromium, on Agent1s's live 0.7.11 board, 10 s at rest in the Agents view)
| | main thread busy | style recalc |
|---|---|---|
| as shipped, 4 working | 2,484 ms | 299 ms |
| as shipped, 6 working | 6,145 ms | 989 ms |
| the two glows off | 166 ms | 22 ms |
| the same glows in steps() | 4,420 ms | 647 ms |
| the same glows as opacity overlays (this change), 6 working | 547 ms | 56 ms |
The page drew 1,440 frames in 10 s at rest. The cost is style recalculation and paint: working-pulse animated the
box's background-color and breathe the pill's background and border, which the browser cannot animate on the GPU,
so every working box was restyled and repainted on every frame. Every keystroke and click waits behind that on the
page's one main thread, which is the typing and click lag Josh and a user reported. It grows with the number of
agents working.

## The change (web/index.html)
- working-pulse: `.acard.working`, `.lrow.working` and `#pj-one-agents .pj-member.pjm-working` get
  `position: relative; isolation: isolate` and a `::before` layer (#2f7d5a, inset 0, z-index -1, radius inherited,
  no pointer events) whose opacity goes 0 to .10 and back over 3.6 s. At its peak that is 10% green over the box,
  where the old colour was the surface with 10% green mixed in.
- breathe: the Working pill keeps the breath's LOW point as its own background and border, and a `::before` layer
  holding the difference up to the old HIGH point fades 0 to 1 and back over 2.4 s.
- Reduced motion: as before, nothing moves; the pill keeps its old static midpoint.
- pinWorkingPulse (#3956, keeps every pulse in phase across rebuilds) reads `getAnimations({ subtree: true })`,
  because the animation now runs on the box's ::before. The keyframes keep the name working-pulse for it.

## Why the positioning is safe (measured, not assumed)
On the live page, before choosing: 60 glowing boxes (20 cards, 20 pills, 20 rows). No descendant is positioned
against, or stacked (z-index) over, anything outside its box, and adding `position: relative; isolation: isolate`
to all of them moved none of 1,015 element rectangles.

## Decisions
1. An overlay that fades, not steps() on the colour (measured: steps() barely helped) and not removing the glow
   (Josh asked for it, #3956).
2. The overlay sits over the wash rather than under it (the old colour was under the wash). The difference is
   under the static wash's own alpha and did not show in side-by-side screenshots.
WEAKEST PREMISE: that the look is unchanged in dark mode and on the phone layout; the screenshots so far are light,
desktop. /design-shots owes the rest.

## Tests
- docs/browser-checks/render-working-pulse-3956.js: its two instruments read what the screen shows now (the
  ::before's animation; the box's colour with the ::before composited at its opacity), and it adds: the pulse and the
  breath animate ONLY opacity, both on a ::before, and the working card itself runs no animation.

## Measured on this branch
- render-working-pulse-3956 on the fixed page: 46 of 46, Chromium and WebKit, including the look (the ground swings
  toward green and stays light, swings in dark, does not snap back on a rebuild, holds still under reduced motion).
- The same check on origin/main's page, as a control: its new assertions fail there (the pulse animates
  backgroundColor, on the box; no ::before), so they can tell the two apart.
- Node tests that read the page or the glow (server.test.js, web.not-running, web.pill-remembered-3958): 370 of 370.

## Review round 1 (one blind reviewer): one BLOCKER, three should-fix, three nits
1. BLOCKER, taken: the new look switches the pulse off on its plain member rows with `animation: none` on the box;
   the pulse now runs on the ::before, so those rows would have pulsed. The rule now removes the ::before
   (`content: none; animation: none`), and render-newlook-4470's "every member row is plain" reads the ::before too
   (it read only the box, so it passed with the pulse on screen).
2. Taken: the pill's border is 1.5px but its layer covered 1px, so the ring was two-tone and darker at the peak.
   The layer now sits 1.5px out with a 1.5px ring at .39, which composites to the old .62 over the pill's .38.
3. Taken: in dark, the pill's resting border became the theme's static mint (the old running animation had
   outranked it). The breath's colours and layer now apply only while motion is allowed, with `:root` in front
   (0,5,0) to outrank the dark pill rules (0,4,0).
4. Taken: with reduced motion the light pill's border dropped from .55 to .38. With reduced motion nothing of the
   breath applies now, so the pill is exactly what it was.
5. Taken: the card, row and member layers sit out by the box's border width (the old background was painted under
   the border), and a layout that removes the border gets inset 0. The pulse layer exists only while motion is
   allowed.
6. Not changed, disclosed: in the one-screen layout the row's hover ring is drawn with the box's background, so the
   layer tints it about 10% green at the pulse's peak. Cosmetic.
7. Taken: render-working-pulse-3956 now asserts the pill's layer covers its whole border, the pill rests at the
   breath's low point in light and dark, and with reduced motion the pill is its old static self with no layer.

## Not done
- /design-shots (light and dark, desktop and phone) for a design review: the set taken at 16:02 predates review
  round 1 and is NOT to be reviewed; shoot again.
- Review rounds, both browser-check gates, a full run.
