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
