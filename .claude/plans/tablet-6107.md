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
