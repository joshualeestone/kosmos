# #6107 tablets as a first-class design: step 1, mockups for Josh

Owner: Angel. Started 2026-10-13 17:51 CDT. Local only (CI hold from Splinter 17:47).

## Finished looks like
Step 1 (done 18:15, on branch tablet-6107): Josh has the iPad mockups in his channel. This branch
(tabletcards-6107) is the first build: the portrait board cards and the portrait project room; see
"This branch" below for what it changes and its own done-when.

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
- Cards: an upright touch tablet (portrait, 600px to 68rem wide) gets the agent cards two
  across, face left, name, role and state stacked beside it, the task underneath. Classic look only.
- Room: pjPhoneOrder gains PJ_TABLET_MQ. On an upright tablet the conversation goes before
  Members/Files (as on a phone) and Tasks moves to the front as a sideways row. DOM moves only (#1017).
- Checks: web.room-phone-718.test.js covers the tablet branch; render-room-msgbox-2806.js turns the
  phone to 800x400 (800x800 with touch is now a tablet) and gains a tablet arm at 834x1194;
  render-home-phone-718.js gains a tablet card arm with a landscape control; mobile-shots.js marks
  the tablet sizes `tablet: true` and skips phone-only screens there.
Rejected: CSS order for the room (splits reading order from what is seen; the guard refuses it).
Weakest premise: that portrait plus 600px wide means tablet. A foldable phone opened (about 673px
wide, portrait) gets the tablet layout, which suits its screen. Landscape tablets are untouched here:
they wait on Josh's split-view call. Review round 1 moved the queries from min-height to orientation.
Done when: the shots at tab8 / ipadmini / ipad11 show the two-across cards and the tasks-first room,
the room browser check passes, CI is green, and Josh has seen the shots.
Known limit (review round 2): orientation is the viewport's aspect, not the device's. Where an
on-screen keyboard shrinks the layout viewport enough to make a portrait tablet wider than tall
(split screen, some Android WebViews), the room reorders mid-post. The composer's column never
moves, so focus survives; the page shifts. A real iPad or 10-inch Android keeps portrait with the
keyboard up (834x~750, 800x~880). Revisit with the landscape split view.
Design note for Josh's review (round 5): with no tasks, the empty Tasks block (its message and New task)
sits above the conversation on an upright tablet, pushing the composer down by that block. Shown in the
tablet shots; he can rule it smaller or folded away.
Design note for Josh (round 11): the project tip's steps still run Members, Conversation, Files,
Tasks, while an upright tablet now shows Tasks, Conversation, Members/Files, so the tip jumps around
the page. Every step still lands on screen (checked); reordering the steps is a follow-up if he wants it.
