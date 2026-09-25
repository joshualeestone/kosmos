# #3757: agent page Files and nav (Josh, 0.6.94, 11:07)

## What
- Files in the sidebar: hidden entirely when the agent has no files (a folder not made yet, an empty
  folder, or none of its own: 404). With files: "Files" header, the first 10 (as the project page's
  list), and "View All" at the right of the header only when there are more (Josh: "a View All if
  we exceeded the number that we display"). No "Open in Finder" there, and no "And N more" line.
- View All opens a Files screen: a new agent-page section (#d-sec-files, data-sec "files", no pill of
  its own) with the title "Files", Open in Finder (moved here, same id and Windows copy), every file
  up to the route's cap of 500, and a line for anything beyond it. Focus moves to it (detailGo).
- A read that FAILED is not "no files": the sidebar keeps the section and says why.
- Nav: every label takes the agent title's font (.detail-meta, --text-callout, 12px); boxes shorter
  through padding and the icon-label gap (84 -> 65px, 73 -> 57px); icons (24, 20) and the two-across
  grid unchanged; no label cut.

## Decisions
- 10 listed: the project page lists 10. View All only past that, per Josh (the project page shows it
  whenever there are files; not changed here, that is #3756's page).
- The Files screen is an agent-page section, not the project Documents view: that view is a
  project's (its back button and its room's attachments), and a section keeps the agent's own nav.

## Weakest premises
- OPEN IN FINDER IS NOW REACHED ONLY THROUGH VIEW ALL, and View All shows only past 10 files, per
  Josh's own words ("a View All if we exceeded the number that we display. Right now we would just
  say Files"). So an agent with 1 to 10 files has no Open in Finder on its page (review pass 1, W1).
  One line to overturn: show View All whenever there are files, as the project page does.
- "not show this section and show that it has no files" read as: the section's absence IS the
  signal; no "has no files" sentence in the sidebar.
- "The same size as the agent's title" read as the title LINE under the name (#d-meta, "Archivist"),
  per Splinter's card text, not the name itself (which is far larger).

## Tests
- web.agent-files-3614.test.js reshaped (11 pass): no section with no files, View All only past the
  list, 404 hidden in the sidebar and worded on the screen, the screen's list and floor line, Finder
  moved, View All opens the screen.
- render-agent-files-3614.js reshaped (37 arms, both themes, 760 wide): red on main for the new arms.
- Shots: ~/.cache/claude-handoffs/shots-3757/{before,after}.

## Review pass 1 (opus): 1 blocker, 4 warnings, 5 nits
- BLOCKER render-thread.js's #3542 arm expected the 404 sentence in the sidebar -> the arm now asserts
  no Files section for the borrowed name and never "no agent by that name"; the 404 sentence lives on
  the Files screen (unit-tested). Control: the old arm passes on main, the new one on the branch.
- W1 Finder unreachable with 1 to 10 files -> kept per Josh's words; now the first weakest premise.
- W2 the Files screen went stale when the folder emptied, 404'd or was refused -> it repaints from
  every branch after the stamp check. Unit arm, red without it.
- W3 the poll repaint and the network-error path had no arm -> unit arms, each red without its fix.
- W4 no way back from the Files screen -> "<- Direct Message" back button, as the project file view
  has; browser arm. (The Files screen is not in the URL: a refresh lands on Talk. Not taken.)
- N1 empty band under the title -> the empty message collapses. N2 double fetch -> removed.
  N3 (the list twice at 56rem and below), N4 (nav measured at light 1400 only), N5 (tight limits,
  still red on revert): not taken.
