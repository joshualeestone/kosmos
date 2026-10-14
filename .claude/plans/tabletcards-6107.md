# #6107 tablets as a first-class design: step 1, mockups for Josh

Owner: Angel. Started 2026-10-13 17:51 CDT. Local only (CI hold from Splinter 17:47).

## Finished looks like
Josh has, in his channel, (a) what a tablet shows today at real tablet sizes and (b) mockups of the
board, a direct message and a project room on an iPad, portrait and landscape, with the choices
named so he can pick. Nothing in web/index.html changes in this step.

## Steps
1. Add tablet sizes to docs/browser-checks/mobile-shots.js (tab8, ipadmini, ipad11, ipad13, plus
   landscape) so the sanctioned tool can shoot them. Kept for step 3; not in the default sweep.
2. Shoot today's board at those sizes (home, agents list, agent page, chat, projects, room, settings).
3. Static mockups (~/work/design-shots/kosmos-6107/mockups/tablet-mockups.html, board tokens),
   rendered at iPad 11-inch portrait and landscape.
4. Post both sets to Josh, comment on #6107.
5. After his pick: build the tablet tier (a separate PR, after UNHOLD).

## Decided
- Mockups are static HTML, not CSS injected into the live board: the split view needs the list and
  the conversation on screen at once, which today's page never renders together.
- Landscape iPad: split view (list + conversation), like Messages. Portrait: one pane with a
  slide-over list, like Mail. Weakest premise: that Josh wants the conversation, not the card grid,
  as the landscape home; the grid stays one tap away in the rail header either way.

## Build slices (drafted 18:58, from reading web/index.html on d9ffd9e65)
A. Touch-tablet tier selector: one rule set keyed on (hover: none) and (min-width: 600px), so tablets
   stop inheriting phone rules (600-639px) or desktop-squeezed rules (640-1023px) by accident.
B. Agents, portrait: cards two across with the latest line and an act button (.cards grid, card
   renderer). Holds whichever landscape answer Josh gives.
C. Agent page, landscape: the left column (profile, three-button nav, files) becomes the agent list;
   Profile / AI Settings / Files move into the conversation header. Depends on Josh's landscape call.
D. Agent page, portrait: conversation full width, the list as a slide-over.
E. Project room: three columns in landscape, the tasks strip in portrait.
Each slice is its own PR with tablet shots from mobile-shots.js (sizes added in this branch).
Order: A, B (now), then C to E after Josh answers or by 2026-10-14 noon on my own call.

## This branch (tabletcards-6107): slices A and B plus the room, 2026-10-13 evening
Built ahead of Josh's answer on the landscape question, on the standing rule (decide, keep going):
these pieces hold whichever landscape layout he picks.
- Cards: an upright touch tablet (600 to 1023.98px wide, at least 560px tall) gets the agent cards two
  across, face left, name, role and state stacked beside it, the task underneath. Classic look only.
- Room: pjPhoneOrder gains PJ_TABLET_MQ. On an upright tablet the conversation goes before
  Members/Files (as on a phone) and Tasks moves to the front as a sideways row. DOM moves only (#1017).
- Checks: web.room-phone-718.test.js covers the tablet branch; render-room-msgbox-2806.js turns the
  phone to 800x400 (800x800 with touch is now a tablet) and gains a tablet arm at 834x1194.
Rejected: CSS order for the room (splits reading order from what is seen; the guard refuses it).
Weakest premise: that 560px of height separates a tablet from a phone on its side. Every current
phone is under 500px tall in landscape; a foldable opened sideways could land either side.
Done when: the shots at tab8 / ipadmini / ipad11 show the two-across cards and the tasks-first room,
the room browser check passes, CI is green, and Josh has seen the shots.
