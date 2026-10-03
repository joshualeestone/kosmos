# newlook-settings-4470: Settings in the new look, behind the switch

Card: kosmos#4470 (page order: project page, Agents, Tasks, an agent's page, Settings, phone). Stacked on
newlook-dsec-4470 (slice 3), which is stacked on newlook-dleft-4470 (slice 2): merge in that order.

Finished looks like: with the new look on, Settings wears the agent page's dress. On a wider screen the section nav is
one grey box with its items flat (no edge, no gold), the current one a tile in the page's ground in full ink at today's
heavier weight; on a phone the nav stays today's sideways scroller with its fade (no box), the current item a grey
tile. The boxes have no edge and 28px corners, box headings take the grey sentence case, field labels sentence case in
full ink. With the look off, nothing changes.

Decided: the solid gold current item goes, as on the top tabs and the agent page, where "current" is ink, weight and a
tile, never gold. The phone keeps its scroller's geometry, as the phone chat kept its own in slice 2, because its
padding carries the fade. Rejected for this slice: the gold-edged buttons and the fields (the whole app's controls, a
slice of their own), and left-aligning the nav items (a layout change nobody asked for).
Weakest premise: centred items in a box read as a list. Left-aligned may read better; it is a one-line change if so.

Validation: render-newlook-4470 gains SETTINGS_LOOK (on in light, dark and 390; off control equal to the before-switch
reading with today's gold, edges and capitals pinned). mobile-shots gains nl-settings. Negative control: without this
CSS the 6 new arms fail (217/223), nothing else does.

Review R1 (opus) 0B 3W 0C 3N:
- WARNING: the Kosmos+ section repaints the page navy (body.plus-active) and the look's greys do not follow: every
  Settings rule is now body:not(.plus-active), so that section keeps today's chrome. Arm: plus-active set in the read,
  the nav must not be the grey box and the current item keeps its edge (round-0 CSS: the grey box, red).
- WARNING: the current item's needs-you dot kept the dark red tuned for the gold (about 1.2:1 on the dark tile):
  --warn-ink, as #d-nav does. Arm: the Kosmos+ item (the only one with a dot) made current with its dot on; the first
  version of this read fell back to the button's own ground when the current item had no dot, so it could not fail;
  it now reads the real dot or says 'absent' (round-0 CSS: #7a1b12, red).
- WARNING: 641 to 896px unmeasured: rendered at 800 (the box wraps the items in rows inside the page) and an arm at
  800 asserts the box and no sideways scroll.
- NITs left: the hover rule applies on a phone too (no box there, so only the ink changes, harmless); the label rules
  repeat the agent page's (kept apart so each page's slice can move alone); rebase after the earlier slices land and
  re-run render-newlook-4470 on the rebased head.
Validation now: 228/228.

Review R2 (sonnet) 0B 2W 0C 3N, CONVERGED:
- WARNING deferred: plus-active on the agent page. Measured: syncPlusChrome sets it only when plusOnScreen() is true,
  which needs SETTINGS_SEC === 'plus' with Settings on screen, so it is never set while the agent page shows.
- WARNING deferred: a Settings box whose edge carries meaning. Measured: all 24 boxes in #panel-settings are a plain
  class="dbox" with no modifier, and no rule, inline style or script gives a .dbox a coloured edge.
- NITs left: hover can stick after a tap on a phone (today's .snav hover has the same property); the 40rem pair of
  boundaries; SETTINGS_LOOK samples the first box (the rule is one selector).
