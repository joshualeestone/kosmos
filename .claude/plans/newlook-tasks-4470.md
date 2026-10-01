# newlook-tasks-4470: the Tasks page in the new look (behind the switch)

Card: kosmos#4470 (one page at a time; its order: project page, Agents, Tasks, an agent's page, Settings, phone).
Follows #4791 (Agents cards) and #4809 (Agents list). The Agents org chart needed nothing (rendered and noted on the card).

Finished looks like: with the new look on, the Tasks page speaks the Agents pages' language: a plain tile and the task
list have no border and 16px corners; the red edge of Needs Your Decision (while it holds tasks) and the gold of a
filtering tile stay, and under the pointer a tile shows its border (a control, like the Agents rows). Of the #3949
rulings, the six tiles in Josh's order, the two bands, no frame and no coloured left edges hold; the bands' SHADES
swap with the look on (white page above, the new look's grey below, white cards on it), which comes from the look's
colour remap, not this change, and is noted on the card. With the look off, nothing changes.

How it was decided: rendered first, look off and on, desktop and phone, light and dark (mobile-shots, new screen
nl-tasks). The new look's colour tokens already remap the page (white page, grey tiles, grey lower band with white
rows); what was left was the borders. No drawing exists for Tasks; this applies the approved Agents rule ("a plain card
loses its border; its grey ground is the separation"), not a new design.
Rejected: restyling task rows into the project page's compact task cards (a different component, and no drawing).
Weakest premise: that the tiles, which are also filters, read as clickable without a border. Their hover ground and the
gold filtering edge carry that, as the Agents tiles' do.

Validation: render-newlook-4470 gains tasksLook (on and off); render-tasks-view-3559 must stay green (its #3949 arms).

Review R1 (opus) 1B 3W 0C 5N: the "same red on and off" arm failed on a correct page (the red is mixed with the rule
grey, which the look remaps): now "reads red in both"; tiles lost the hover border the Agents controls keep: restored
under the pointer, with an arm; nothing proved a zero decision tile goes plain: arm added; the plan overclaimed the
#3949 bands: corrected (above). NITs taken: the comment's corner claim; tasksLook moved above listLook's comment; the
off arm checks the list radius. Left: no consolidated-layout arm (today's look kept there, as on every page);
nl-tasks's place in SCREENS.
Review R2 (sonnet) 1B 1W 0C 2N: my R1 red check read only rgb()/rgba(), but a color-mix() border computes to
color(srgb ...) (0-1 channels), so it would fail on a correct page: now one parser reads both, with a negative control
(a plain border is not red); the hover read fell back to body (not transparent) on a miss: a miss is now reported as
"missed"; NIT taken: the pressed arm asserts gold, not merely non-transparent. Left: a tapped tile on a phone keeps
its hover border until the next tap (as the Agents rows do).
Review R3 (opus) 0B 2W 0C 2N: the negative control read a hard-coded grey, never the page: replaced by two read off
the page (the filtering gold, the closest wrong answer, and the look-off plain border, both must not read red); the
red test accepted dark gold (#d6a62e is red-dominant): it now also requires green and blue close together (reds under
7 apart, golds over 80), checked against both golds and both reds. NIT taken: forged attributes restored in finally.
Left: the look-off hover value is read and not asserted.
