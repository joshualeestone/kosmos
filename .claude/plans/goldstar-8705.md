# goldstar-8705: the starred star, no stroke, brightest gold, a burst on tap (kosmos#8705)

## Finished looks like
On a served build, a starred star in the agent grid and the agents list (tabs and the consolidated rail) has no
stroke, is filled with --gold-bright, and a press that stars it plays a small burst (a pop and six gold sparks), never
under reduced motion, where it just fills. Design shots light and dark at desktop and phone.

## Why it still read dingy (asked first, Josh's point 2)
#7339 (PR #7351) already filled the star with --gold-bright, the brightest gold token. It also kept a darker #9c741b
edge (1.5px, .75px on 2x) on light, because --gold-bright alone is about 1.9:1 on white, under the 3:1 a graphic
needs. That dark ring around a bright fill is what reads dull. Measured: on main every starred star's path has
stroke rgb(156,116,27). So the fix for "dingy" IS dropping the stroke; no new colour.

## Calls
- Stroke off by default, in every theme. Josh's ruling; the trade is the light star at about 1.9:1 on white
  (WCAG 1.4.11). Starred is still distinct by shape (filled versus outline) and by its label (Unstar <name>).
- The edge comes back under prefers-contrast: more, so a person who asked their system for contrast keeps the
  3:1 edge #7339 built. Forced colors keep their system fill. Rejected: keeping the edge for everyone (it is the
  dingy look Josh named twice).
- The burst carries across repaints: the save's answer and the 5 s poll repaint the stars within milliseconds, so
  starBtn redraws a star mid-burst with a negative animation delay (STAR_BURST). Without that, the save's repaint cut
  the burst off before it played (seen in render-star-6719's first run of the burst arm; the check now asserts the
  star the save's repaint draws carries the burst on, and goes red with the carry-over disabled).
- Weakest premise: "agent's page" means the agents grid; no agent detail page draws a star (starBtn has six
  callers, all tiles and list rows).

## Status
- [x] CSS: no stroke, more-contrast edge, burst keyframes, reduced motion
- [x] JS: starBurst, STAR_BURST carried by starBtn
- [x] render-star-6719: no stroke by default, edge arms under more contrast, burst arms (270/270; main fails the 20 new)
- [x] design shots: ~/work/design-shots/kosmos-8705/ (8 shots, posted on the card)
- [x] iPhone star compared: it differs, carded as #8706
- Known, cosmetic: the top spark of the first My Agents row can be clipped by that list's scroll box.
