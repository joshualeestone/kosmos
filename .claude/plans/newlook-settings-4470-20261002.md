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
