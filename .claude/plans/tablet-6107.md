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
