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

## Weakest premise
- "The same size as the agent's title" read as the title LINE under the name (#d-meta, "Archivist"),
  per Splinter's card text, not the name itself (which is far larger).

## Tests
- web.agent-files-3614.test.js reshaped (11 pass): no section with no files, View All only past the
  list, 404 hidden in the sidebar and worded on the screen, the screen's list and floor line, Finder
  moved, View All opens the screen.
- render-agent-files-3614.js reshaped (37 arms, both themes, 760 wide): red on main for the new arms.
- Shots: ~/.cache/claude-handoffs/shots-3757/{before,after}.
