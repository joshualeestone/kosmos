# newlook-tasks-4470: the Tasks page in the new look (behind the switch)

Card: kosmos#4470 (one page at a time; its order: project page, Agents, Tasks, an agent's page, Settings, phone).
Follows #4791 (Agents cards) and #4809 (Agents list). The Agents org chart needed nothing (rendered and noted on the card).

Finished looks like: with the new look on, the Tasks page speaks the Agents pages' language: a plain tile and the task
list have no border and 16px corners; the red edge of Needs Your Decision (while it holds tasks) and the gold of a
filtering tile stay; every #3949 ruling holds (six tiles in Josh's order, two bands, no frame, no coloured left edges).
With the look off, nothing changes.

How it was decided: rendered first, look off and on, desktop and phone, light and dark (mobile-shots, new screen
nl-tasks). The new look's colour tokens already remap the page (white page, grey tiles, grey lower band with white
rows); what was left was the borders. No drawing exists for Tasks; this applies the approved Agents rule ("a plain card
loses its border; its grey ground is the separation"), not a new design.
Rejected: restyling task rows into the project page's compact task cards (a different component, and no drawing).
Weakest premise: that the tiles, which are also filters, read as clickable without a border. Their hover ground and the
gold filtering edge carry that, as the Agents tiles' do.

Validation: render-newlook-4470 gains tasksLook (on and off); render-tasks-view-3559 must stay green (its #3949 arms).
