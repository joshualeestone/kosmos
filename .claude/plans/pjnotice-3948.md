# #3948: the project notice in the consolidated layout

## Finished looks like
A person in the consolidated layout sees the same project notice (#3923), with the same rows and
Try again, straight above the consolidated Agents list, and a screen reader announces it.

## What is built
1. A second live region `#alist-pj-notice` (role=status, aria-live=polite, never hidden itself) plus
   its own hidden success line `#alist-pj-notice-said`, INSIDE the Agents rail head `#rail-agents`.
   Not a body child: the consolidated grid's 38 pre-rail rows are full (web.consolidated-980.test.js),
   and a body child with no row lands as a full-width strip at the top of the page (round 1).
2. The head wraps; the notice is a full-width line under the name and the +. Unfolded: row-gap 0 (an
   empty notice adds no height) and a 0 flex basis on `.lead` (the + stays on the name's line in a
   200px rail). Folded (48px strip): the notice is hidden.
3. `paintRailPjNotice()` paints it only in the consolidated layout with a project open, from the same
   roster as paintOneProject; called by paintAgentList, loadProjects, showTab and the retry handler.
   It clears the rail's success line on a project switch or leaving the layout.
4. The Try again listener is one named handler `pjNoticeRetryClick` on both notices; the rail branch
   repaints the rail, writes the rail's success line, and falls back to focusing the rail's name when
   no row is left ("Project Members" while the members head the list; "Agents" on an empty board or
   after a failed status read, which still names the rail).

## Tests
- web.project-notice-3923.test.js: harness re-anchored to the named handler; rail arm (repaint,
  success line, focus to the rail name) with the tab-layout control; paintRailPjNotice paint and
  clearing. Each proven red with its piece removed.
- docs/browser-checks/render-projects.js: enters the layout through applyLayout (no direct paint),
  asserts the notice in the head straight above the list, in its column, adding only its own height;
  empty once the layout is put back. Proven red with the paint blanked, the notice displaced, and the
  row gap restored.

## Decided
- Placement in the rail head, per the card's example ("above the consolidated Agents list").
  Rejected: inside #alist (rewritten every poll: re-announcement and lost focus); a new grid row (the
  38-row headroom is full).
- Folded rail hides the notice: no room for a sentence in 48px. Weakest premise: that silence while
  folded is acceptable; unfolding shows it again but does not re-announce it.
