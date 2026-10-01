# newlook-agent-4470: an agent's page in the new look, slice 1 (the conversation), behind the switch

Card: kosmos#4470 (page order: project page, Agents, Tasks, an agent's page, Settings, phone). Follows #4859 (Tasks).

Finished looks like: with the new look on, an agent's Direct Message reads as the project room does in Josh's v9
drawing: the conversation on the page's own ground (no grey band), your messages in the one grey, an agent's with no
bubble, the composer a grey pill with no stroke. With the look off, nothing changes.

How it was decided: rendered first (mobile-shots agent-chat / agent-profile, look off and on, desktop and phone). With
the look on, the DM column turned grey (#d-talk-box paints the surface token, which the new look remaps) while the
bubbles kept today's tints: the inverse of the approved room. The DM is the same thread component (.msg / .msg-bd), so
the room's approved rules are pointed at #d-dmthread; nothing new is drawn.
Scope: the conversation only. The left column (the nav buttons, the Files box, the "FILES" capitals) and the Profile
and AI Settings sections are the next slices, each its own PR, because each is its own judgement.
Weakest premise: that a DM should look exactly like a room (the agent's messages unboxed). The room's reason holds
here too: the avatar, name and time say who.

Validation: render-newlook-4470 gains DM_LOOK (on: page ground, grey yours, unboxed agent's, grey pill composer;
off: today's, the control).

Review R1 (opus) 1B 4W 1C 2N:
- BLOCKER: the DM composer is one element with both classes (dmbar composerbox), not the room's nested pair, so the
  composer rules and DM_LOOK's composer read matched nothing (the check could never have passed): now .dmbar.composerbox.
- WARNING: no chosen-Dark DM arm (the forced-dark rules sit later): added, with the agent bubble's tail colour, which is
  the value that tells right from wrong in light.
- WARNING: the off control was weak for "byte for byte": it now compares the whole reading to the one taken before the
  switch was ever touched.
- WARNING: the consolidated layout keeps today's DM, as every page does under the look (the gate is body:not(.consolidated));
  its grey band there comes from the global token remap, not this slice. Noted, not changed here.
- WARNING: an outside sender's dash on an unboxed message is about 1.2:1 on white, the same as the room: noted for the
  slice that settles strokes.
- CONVENTION: the comment named element ids (the surface gate reads comments as tokens): reworded.
- NITs: own-message attachment cards grey on grey (as the room); DM_LOOK only for colours. Left.
Review R2 (sonnet) 0B 2W 1C 2N: the tail was read under a hidden panel (a pseudo-element may not answer there): DM_LOOK
now shows the panel for the read and restores it; the off control could pass a leak (two equal readings): today's
values are now pinned too (your bubble not the look's grey, an agent's not the bare page, a bordered 12px composer).
NIT taken: border 0 like the room's pill (no 2px difference), so the arms read the border WIDTH (a removed border still
reports a colour). CONVENTION: d-dmthread is in 16 other checks' surfaces; the PR's CI selects them (bc-pr-select).
Left: the agent page's terminal composer keeps today's look; it belongs to the AI Settings slice.
